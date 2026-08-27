/**
 * 学習クイズ（P8-3 / P8-4 / P8-5調整 ／ 2026-08-20 につまみを畳んで4択化）
 * - SameCompoundQuiz: 見本1枚＋選択肢4枚から「見本と同じ化合物」を選ばせる
 *   （2026-08-20 まではこれが2択「同じ／違う」だった。2択は収録用の形として残っている）
 * - NamingQuiz: 意図的に崩した表記の構造式を提示し、名称を4択で答えさせる
 * 共通機能: **人が触るつまみは「出題範囲」と「難易度」の2つだけ**
 * （範囲＝レベル＋分野／難易度＝崩し方＋誤答の紛らわしさ。→ QUIZ_DIFFICULTY の説明）、
 * describeStructure による構造ポイントの解説。
 * 問題は既存ライブラリ（stages.json + compounds.json）から自動生成し、
 * 正誤の正は verifyMolecule（トポロジー同値）に置く。
 */

// ===== 共有ヘルパー =====

/**
 * ===== 出題プールの「分野」と「範囲（レベル）」（2026-08-20・ユーザー検品） =====
 *
 * ユーザー申し立て:「命名クイズ: 高校範囲を超えている物質もある。難易度設定・絞り込みできる
 * ようにしたい」「分野は、脂肪族、芳香族、など大きなくくりの方がよいのではないか」
 *
 * **根っこ（実測。`node tools/quiz-scope-census.js` で誰でも数え直せる）**
 *   出題プール ＝ stages.json 120件 ＋ compounds.json 939件 ＝ 1059件。
 *   `compounds.json` に `series` フィールドは無いので、**939件すべてが
 *   「その他の有名化合物」という1つの箱**に入っていた ＝ プールの 88% が1箱で、
 *   系列を選んでも実質絞れない。しかも compounds.json は**作図の網羅性のために作った
 *   名称ライブラリ**（アミド65件などが「残量を0にする」目的で入っている）であって、
 *   出題のために選ばれたものではない。アドレナリン・カプサイシン・コレステロール・
 *   N-メチル-2-ピロリドンが既定で出ていたのはここから来ている。
 *
 * **分野は導出できる**（下の compoundFieldOf）。構造だけで 1059 件を5つに分けられ、
 * 「その他（分類できなかったもの）」は 37 件に収まる。**この37件は画面に出す**
 * （分野の選択肢のラベルに件数を書く）。隠すと分類器の外れが見えなくなる。
 *
 * **範囲（高校で扱うか）は導出できない。** 試したのは
 * `findOutOfScopeMotifs` ／ 重原子数の上限 ／ ヘテロ環・縮合環の除外 ／ 官能基の種類数、
 * の4つを合わせた規則で、**1059件のうち外せたのは 116件だけ**。しかも
 * 水・アンモニア・ナフタレン・ピクリン酸・ピリジン・β-D-グルコース・パルミチン酸・
 * ステアリン酸・ε-カプロラクタム（**どれも人が選んだお題**）が誤って外れ、
 * 逆に N-置換アミド65件・ドーパミン・アドレナリン・メントール・リモネンは残った。
 * 「高校で扱うか」は**構造の性質ではなく教科書の採否**なので、構造からは決まらない。
 *
 * そこで範囲は**名簿で決める**。3段:
 *   1 教科書 … `stages.json` のお題（人が選んだラインナップ）＋ `quiz-scope.json` の名簿
 *              （教科書に名指しされるのにお題に無いもの。1行1件・追記のみ）
 *   2 ＋命名の練習台 … 1 ＋ `iupacName` が名前を作れて重原子12個以下のもの
 *              （＝ 直鎖・分岐のアルカン／アルケン／アルキン、ハロゲン化アルキル、
 *                アルコール、エーテル。「覚える化合物」ではなく**規則を当てる練習台**で、
 *                DESIGN_puzzle_lineup.md の分け方と同じ線）
 *   3 すべて … 全1059件（今までの挙動。大学初級・範囲外を含む）
 * **既定は 1**（今までの既定「全部」が、高校範囲外を出していた原因そのもの）。
 */
const QUIZ_FIELDS = ['脂肪族', '芳香族', '天然有機化合物', '高分子', 'その他'];

const QUIZ_SCOPE_LEVELS = [
    { value: 'basic', level: 1, label: '教科書（お題と定番）' },
    { value: 'named', level: 2, label: '＋命名の練習台' },
    { value: 'all',   level: 3, label: 'すべて（大学初級を含む）' }
];
const QUIZ_SCOPE_DEFAULT = 'basic';
// レベル2 に自動で入れる図の大きさの上限（重原子の数）。
// 12 は「C₈ の異性体まで」＝ 命名規則の練習で実際に書かせる範囲
const QUIZ_NAMED_HEAVY_MAX = 12;

/**
 * ===== 図の長さの上限（2026-08-21・ユーザー決定） =====
 *
 * ユーザー原文（2026-08-20）:
 *   「**ステアリン酸などは題材としてあまり適していない**（長い直鎖が曲がっているかどうか、
 *     原子の数が変わっていてもカウントしづらい）」
 *   「**鎖10で油脂以外は問題ないかと思います。引っかかるとすれば、入試の2価以上のエステルです。
 *     同じ分子を探す問題なら10で切って問題ないと思います**」「**クイズでは区切ってよい**」
 *
 * **測るのは「環の外の最長鎖」1本**（重原子数でも環の有無でもない）。理由は
 * ORDER_quiz_2026-08-20.md §3-3(b) の実測:
 *   ・同じ重原子14個に **アントラセン[鎖0]** と **ラウリン酸[鎖12]** が並ぶ
 *     ＝ 重原子数では「芳香族はそこまで複雑ではない」というユーザーの体感と分かれない
 *   ・難しさの源は大きさではなく「**一直線に数えさせられる長さ**」。
 *     ベンゼン環はひとかたまりに見えるので数えないが、CH₂ が18個続く鎖は1つずつ数える
 *   ・環の有無は代理変数にすぎない（反例: **カプサイシンは芳香族なのに鎖9**、
 *     **コレステロールは環4なのに鎖7**、**スクロースは重原子23・環2なのに鎖1**）
 *
 * ⚠ **効かせるのはクイズの出題プールだけ**（`entryInQuizScope` を通る
 * 「同じ化合物はどれ？」と命名クイズ）。名称呼び出し・書き出し練習・名称ライブラリ・
 * お題（`stages.json`）には**入れない**——パルミチン酸やトリステアリンは
 * 教科書のお題そのもので、そこから外すのは別の間違い。
 *
 * ⚠ **つまみにはしない**（v1430 で人が触るつまみを2つに畳んだばかり）。
 * プールの性質として固定で持ち、**外した件数だけを画面に出す**（黙って減らさないため。
 * → `quizOversizedNames` と各クイズの `renderPoolCount`）。
 *
 * **入試の2価以上のエステルは巻き添えにならない**（実測・2026-08-21）。
 * エステル結合を2つ以上もつのはライブラリ全体で17件、鎖10 で落ちるのは
 * トリステアリン[鎖18]・トリオレイン[鎖18]・ジステアリン酸グリセリド[鎖18] の**油脂3件だけ**。
 * 入試で出る二価エステル（マロン酸ジエチル[鎖3]・シュウ酸ジエチル[鎖2]・
 * フタル酸ジエチル[鎖2]・フタル酸ジメチル[鎖1]・PET[鎖2]・無水酢酸[鎖2]・
 * 無水フタル酸[鎖0]・無水マレイン酸[鎖0] …）は**最長でも鎖3**で、上限まで7の余裕がある。
 * 油脂が落ちるのはユーザーの明示（「鎖10で油脂以外は問題ない」）どおり。
 * 数え直しは `node tools/quiz-size-census.js --dropped`。
 */
const QUIZ_CHAIN_MAX = 10;

/**
 * いま効いている上限。**つまみではない**（画面からは触れない。→ QUIZ_CHAIN_MAX）。
 *
 * ⚠ `window` 越しに読むのは**回帰テスト QL2（否定対照）のためだけ**——
 * 上限を一時的に外して「QL1 の緑が空振りでない（外すとステアリン酸が実際に出る）」ことを
 * 示せるようにしてある。読めなければ定数へ落ちる。
 */
function quizChainMax() {
    const v = (typeof window !== 'undefined') ? window.QUIZ_CHAIN_MAX : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : QUIZ_CHAIN_MAX;
}

/**
 * 環に入っていない炭素の、いちばん長い連なり（＝目で追わされる「直鎖」の長さ）。
 * 環の中の炭素は数えない（ベンゼン環はひとかたまりとして見えるため）。
 *
 * ⚠ **ここが `tools/quiz-size-census.js` の物差しの本体**。census 側は
 * `window.longestChainOutsideRing` を呼んで同じ数字を出す（発注書の表と実装がずれないように）。
 */
function longestChainOutsideRing(mol) {
    if (!mol || !mol.atoms || !mol.atoms.length) return 0;
    const ring = (typeof ringAtomIds === 'function') ? ringAtomIds(mol) : new Set();
    const nodes = mol.atoms.filter(a => a.element === 'C' && !ring.has(a.id));
    if (!nodes.length) return 0;
    const ids = new Set(nodes.map(a => a.id));
    // 隣接表を先に作る（分子ごとに一度。毎回 bonds を舐めると 1059 件で効いてくる）
    const adj = new Map(nodes.map(a => [a.id, []]));
    mol.bonds.forEach(b => {
        if (ids.has(b.atomId1) && ids.has(b.atomId2)) {
            adj.get(b.atomId1).push(b.atomId2);
            adj.get(b.atomId2).push(b.atomId1);
        }
    });
    // 環の外なので閉路は無い（＝森）。各点から幅優先で最遠点を測れば最長路が出る
    let best = 0;
    nodes.forEach(a => {
        const dist = new Map([[a.id, 1]]);
        const q = [a.id];
        while (q.length) {
            const id = q.shift();
            adj.get(id).forEach(n => {
                if (dist.has(n)) return;
                dist.set(n, dist.get(id) + 1);
                q.push(n);
            });
        }
        dist.forEach(d => { if (d > best) best = d; });
    });
    return best;
}

function quizScopeLevelOf(value) {
    const hit = QUIZ_SCOPE_LEVELS.find(s => s.value === value);
    return hit ? hit.level : 3;
}

/**
 * 分野（大きなくくり）を構造から決める。**名前の字面は見ない**（DESIGN_compound_coverage.md
 * §2 の「数え直すときは名前でなく target で数えること」と同じ流儀）。
 *
 * 順番に意味がある。高分子 → 天然物 → 芳香族 → 脂肪族 の順に見て、
 * **どれにも当てはまらないものは「その他」として数える**（脂肪族を受け皿にしない）。
 * 受け皿にすると、フラン・ピロール・ラクトン・核酸塩基のような複素環が
 * 「脂肪族」と表示され、分類器が外していることが画面から読めなくなる。
 */
function compoundFieldOf(mol) {
    if (!mol || !mol.atoms.length) return 'その他';
    // 高分子: 擬似元素 R（＝「ここから先も同じ繰り返しが続く」印）を含む図。
    // StereoCountQuiz.isPolymerFragment と同じ理由づけで、名前や原子数では判定しない
    if (mol.atoms.some(a => a.element === 'R')) return '高分子';

    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    const ringIds = (typeof ringAtomIds === 'function') ? ringAtomIds(mol) : new Set();
    const groups = findFunctionalGroups(mol);
    const types = new Set(groups.map(g => g.type));

    // 天然有機化合物（糖・アミノ酸・油脂）——高校の教科書がまとめて扱う章
    //  ・アミノ酸/ペプチド: カルボキシ基（塩を含む）の隣の炭素に N が単結合で付く（α位）
    const aminoAcid = groups
        .filter(g => g.type === 'carboxyl' || g.type === 'carboxylate')
        .some(g => heavyNb(g.atomIds[0]).some(n => n.atom.element === 'C' &&
            heavyNb(n.atom.id).some(m => m.atom.element === 'N' && m.type === 1)));
    //  ・糖: 環の中の O（両隣が炭素＝ヘミアセタール環）＋ -OH 2本以上、
    //        または 鎖状の C=O ＋ -OH 3本以上
    const alcOH = mol.atoms.filter(a => a.element === 'O' && !ringIds.has(a.id) &&
        heavyNb(a.id).length === 1 && heavyNb(a.id)[0].type === 1 &&
        heavyNb(a.id)[0].atom.element === 'C');
    const ringO = mol.atoms.some(a => a.element === 'O' && ringIds.has(a.id) &&
        heavyNb(a.id).length === 2 && heavyNb(a.id).every(n => n.atom.element === 'C'));
    const sugar = (ringO && alcOH.length >= 2) ||
        ((types.has('aldehyde') || types.has('ketone')) && alcOH.length >= 3);
    //  ・脂肪酸・油脂: カルボン酸／その塩／エステルで、環が無く、炭素12個以上
    const nC = mol.atoms.filter(a => a.element === 'C').length;
    const fat = (types.has('carboxyl') || types.has('carboxylate') || types.has('ester')) &&
        ringIds.size === 0 && nC >= 12;
    if (aminoAcid || sugar || fat) return '天然有機化合物';

    if (findAromaticBondKeys(mol).size > 0) return '芳香族';
    // 脂肪族＝炭素をふくみ、環があるならすべて炭素環（鎖式・脂環式）
    const allCarbonRings = [...ringIds].every(id => {
        const a = mol.atoms.find(x => x.id === id);
        return a && a.element === 'C';
    });
    if (nC > 0 && allCarbonRings) return '脂肪族';
    return 'その他';
}

/**
 * ===== 官能基・骨格の軸（E1・2026-08-25・ユーザー承認） =====
 *
 * **なぜ要るか（前レーンの実測・v1450）**: `?scope=` / `?field=` を新設して
 * qa の命名リンク6本を「範囲＋命名の練習台・390件／分野・脂肪族665件」に着地させたが、
 * 止められたのは「**芳香族が出る**」だけで、「**アルカンだけ**」にはなっていない——
 * 脂肪族にはアルコールもケトンもエステルも入る。さらに
 * `org.carbonyl.ester-naming`（エステルの命名）は**脂肪族（酢酸エチル）と
 * 芳香族（安息香酸メチル・サリチル酸メチル）にまたがる**ので、分野では絞れず外したままだった。
 *
 * ★ **軸は内部だけに持ち、URL（`?group=`）からだけ指す。画面のつまみは2つのまま増やさない。**
 * v1430 で「人が触るつまみは 出題範囲 と 難易度 の2つだけ」に畳んだ経緯を壊さないため
 * （＝ `QUIZ_CHAIN_MAX` と同じ扱い。プールの性質として持ち、画面には**効いていることだけ**を出す）。
 *
 * ⚠ **値はすべて構造から導く**（名簿を増やさない）。判定材料は
 * `findFunctionalGroups` の type と、図に出てくる元素だけ。名前の字面は一切見ない。
 *
 * **2種類ある。混ぜると意味が壊れるので分けて書く**:
 *
 * | 種別 | 決め方 | 例 |
 * |---|---|---|
 * | 官能基（`kind:'group'`） | **その基を含んでいれば入る** | `ester` … 酢酸エチル・安息香酸メチル・サリチル酸メチル |
 * | 骨格（`kind:'skeleton'`） | **C と H だけでできている図**の中で、多重結合の有無で分ける | `alkane` … メタン〜・シクロヘキサン |
 *
 * ⚠ **官能基を「含む」にする理由**: 排他（＝その基しか持たない）にすると
 * **サリチル酸メチル**（エステル＋フェノール）が エステル から落ちる。
 * 教科書の定番が落ちるほうが、余分が混じるより害が大きい。
 * ⚠ **骨格を「C と H だけ」に縛る理由**: 縛らないと `alkane` が
 * 「多重結合を持たないもの」＝ **エタノールもグルコースもアルカン**になる。
 *
 * ⚠ **`alkane` はシクロアルカンを含む**（シクロヘキサン・メチルシクロヘキサン）。
 * 構造から見れば環式アルカンで、`org.ali.suffix` が名指しする **cyclo- の使い分け**の
 * 練習台でもある。含めたくない場面が出たら `chain-alkane` のような値を足す（今は要らない）。
 *
 * ⚠ **導けなかったもの**（＝この軸では扱えない。報告済み）:
 *   ・「**単官能**か」…「エステルだけを持つ」は導けるが、教科書の定番が落ちるので採らない（上記）
 *   ・「**主たる官能基**」… 優先順位（カルボン酸＞エステル＞…）は IUPAC の規約であって
 *     構造そのものではない。`iupacName` は接尾辞を1つ選ぶが、名前を作れない分子では
 *     何も返らないので、プールの絞り込みの物差しには使えない（プールの 6割が名無しになる）
 *   ・「**天然物か／合成高分子か**」… すでに `field`（分野）が持っている軸なので重ねない
 */
const QUIZ_GROUPS = [
    // --- 骨格（C と H だけの図） ---
    { value: 'hydrocarbon', kind: 'skeleton', label: '炭化水素' },
    { value: 'alkane',      kind: 'skeleton', label: 'アルカン（環式を含む）' },
    { value: 'alkene',      kind: 'skeleton', label: 'アルケン' },
    { value: 'alkyne',      kind: 'skeleton', label: 'アルキン' },
    { value: 'arene',       kind: 'skeleton', label: '芳香族炭化水素' },
    // --- 官能基（含んでいれば入る） ---
    { value: 'alcohol',  kind: 'group', label: 'アルコール' },
    { value: 'phenol',   kind: 'group', label: 'フェノール類' },
    { value: 'ether',    kind: 'group', label: 'エーテル' },
    { value: 'aldehyde', kind: 'group', label: 'アルデヒド' },
    { value: 'ketone',   kind: 'group', label: 'ケトン' },
    { value: 'carboxyl', kind: 'group', label: 'カルボン酸（塩を含む）' },
    { value: 'ester',    kind: 'group', label: 'エステル' },
    { value: 'amide',    kind: 'group', label: 'アミド' },
    { value: 'amine',    kind: 'group', label: 'アミン' },
    { value: 'nitro',    kind: 'group', label: 'ニトロ化合物' },
    { value: 'nitrile',  kind: 'group', label: 'ニトリル' },
    { value: 'halide',   kind: 'group', label: 'ハロゲン化物' },
    { value: 'sulfo',    kind: 'group', label: 'スルホン酸（塩を含む）' }
];

/**
 * その `ester` 群が**酸無水物の片側**か（-CO-O-CO- の O をはさんで向こうもカルボニル炭素）。
 * `findFunctionalGroups` の ester の `atomIds` は [カルボニル C, =O, -O-] の順。
 */
function isAnhydrideSide(mol, heavyNb, g) {
    const cId = g.atomIds[0], oId = g.atomIds[2];
    return heavyNb(oId).some(n => n.atom.id !== cId && n.atom.element === 'C' &&
        heavyNb(n.atom.id).some(m => m.type === 2 && m.atom.element === 'O'));
}

/**
 * その分子が当てはまる官能基・骨格の値（複数）。**構造だけから導く**。
 * ⚠ `tools/quiz-group-census.js` と回帰テスト QG1〜QG5 はこの1つの定義を読む
 *   （分類の規則を書き写さない ＝ 数字と画面がずれないようにするため）。
 */
function compoundGroupsOf(mol) {
    if (!mol || !mol.atoms || !mol.atoms.length) return [];
    let raw;
    try { raw = findFunctionalGroups(mol); } catch (e) { raw = []; }
    const types = new Set(raw.map(g => g.type));
    const has = (...t) => t.some(x => types.has(x));
    const heavyNb = (id) => mol.getNeighbors(id).filter(n => n.atom.element !== 'H');
    const out = [];

    // 官能基: 含んでいれば入る（サリチル酸メチルは ester にも phenol にも入る）
    if (has('alcohol0', 'alcohol1', 'alcohol2', 'alcohol3')) out.push('alcohol');
    if (has('phenol')) out.push('phenol');
    if (has('ether')) out.push('ether');
    if (has('aldehyde')) out.push('aldehyde');
    if (has('ketone')) out.push('ketone');
    if (has('carboxyl', 'carboxylate')) out.push('carboxyl');
    // ⚠ **酸無水物（-CO-O-CO-）は ester に入れない**（`node tools/quiz-group-census.js
    //   --group=ester --scope=basic` で見つけた。無水酢酸・無水フタル酸・無水マレイン酸の3件）。
    //   `findFunctionalGroups` は -CO-O- を見て**両側に ester を立てる**が、
    //   **紙の上では「無水酢酸」であって「酢酸〜エステル」ではない** ＝
    //   「エステルの命名（酸名＋アルキル基名）を練習する」の練習台にならない。
    //   ここで振るい落としても `field`・`scopeLevel` は変わらないので、
    //   ふつうの出題からは今までどおり出る（効くのは `?group=ester` を指したときだけ）
    if (raw.some(g => g.type === 'ester' && !isAnhydrideSide(mol, heavyNb, g))) out.push('ester');
    if (has('amide')) out.push('amide');
    if (has('amine1', 'amine2', 'amine3')) out.push('amine');
    if (has('nitro')) out.push('nitro');
    if (has('nitrile')) out.push('nitrile');
    if (has('halide')) out.push('halide');
    if (has('sulfo', 'sulfonate')) out.push('sulfo');

    // 骨格: **C と H だけでできている図**に限る。
    // ⚠ 擬似元素 R（＝繰り返しが続く印）を含む高分子はここに入らない
    //   ——ポリエチレンの断片を「アルカン」と呼ぶと、命名の練習台として出てしまう
    const hasC = mol.atoms.some(a => a.element === 'C');
    const onlyCH = mol.atoms.every(a => a.element === 'C' || a.element === 'H');
    if (hasC && onlyCH) {
        out.push('hydrocarbon');
        if (types.has('aromatic')) out.push('arene');
        if (types.has('cc_double')) out.push('alkene');
        if (types.has('cc_triple')) out.push('alkyne');
        if (!types.has('aromatic') && !types.has('cc_double') && !types.has('cc_triple')) {
            out.push('alkane');
        }
    }
    return out;
}

/**
 * いま効いている官能基・骨格の絞り込み（`?group=`）。**画面のつまみではない**。
 *
 * ⚠ 知らない値は無視する（前方互換。qa が新しい語彙を先に配っても壊れない）。
 * ⚠ `window.QUIZ_GROUP_OVERRIDE` に**文字列**を入れると上書きできる。これは
 *   **回帰テスト QG2（否定対照）のためだけ**の口——外すと実際に芳香族が混ざる、を示せるようにしてある。
 *   空文字は「絞らない」。⚠ 一覧の `QUIZ_GROUPS` と紛らわしい名前にしない（1文字違いは事故のもと）。
 */
let _quizGroupFromUrl;
function quizGroupValue() {
    if (typeof window !== 'undefined' && typeof window.QUIZ_GROUP_OVERRIDE === 'string') {
        const v = window.QUIZ_GROUP_OVERRIDE;
        return QUIZ_GROUPS.some(g => g.value === v) ? v : null;
    }
    if (_quizGroupFromUrl === undefined) {
        _quizGroupFromUrl = readForcedFromUrl('group', QUIZ_GROUPS.map(g => g.value));
    }
    return _quizGroupFromUrl;
}

/** 出題件数の行に足す但し書き。**絞られていることを画面に出す**（黙って減らさない） */
function quizGroupNote() {
    const g = QUIZ_GROUPS.find(x => x.value === quizGroupValue());
    return g ? ` ／ ${g.label}だけに絞ってある（リンク元の指定）` : '';
}

/**
 * ===== 名簿の検分（C2・2026-08-25・ユーザー決定「115件を全部見直す」） =====
 *
 * `quiz-scope.json` の `textbook`（115件）は「教科書に名指しされるのにお題に無いもの」の
 * 名簿だが、**誰がどの教科書で見たのかが書かれていない**。そこで同じファイルに
 * `survey`（1行1件・末尾に追記のみ）を足し、**どの教科書で見たか**と ○×を書けるようにした。
 *
 * ⚠ **判定するのはユーザー**。ここは書かれた ○× を読んで効かせるだけで、
 *   こちらが「教科書に載っているか」を決めることはしない。
 * ★ **`×` は実際に効く** —— 書いてもプールが変わらないなら、それは
 *   「仕組みがあるだけ」で検分の意味が無い。`×` の付いた名前は名簿から外れ、
 *   その化合物は範囲「教科書」から落ちる（お題由来・別名一致で残るものは残る）。
 * ⚠ **未記入（空）は今までどおり残す。** 未検分を「×」と同じ扱いにすると、
 *   道具を入れた瞬間に115件が黙って消える。
 *
 * 一覧は `node tools/quiz-scope-review.js`。
 */
function quizScopeSurveyRows() {
    if (typeof QUIZ_SCOPE === 'undefined' || !QUIZ_SCOPE || !Array.isArray(QUIZ_SCOPE.survey)) return [];
    return QUIZ_SCOPE.survey.filter(r => r && typeof r.name === 'string');
}

/** 検分で `×` が付いた名前（＝範囲「教科書」から外すもの） */
function quizScopeRejectedNames() {
    return new Set(quizScopeSurveyRows()
        .filter(r => String(r.verdict || '').trim() === '×')
        .map(r => r.name));
}

/** いま効いている名簿（`textbook` から検分 `×` を引いたもの） */
function quizScopeTextbookNames() {
    const listed = (typeof QUIZ_SCOPE !== 'undefined' && QUIZ_SCOPE && Array.isArray(QUIZ_SCOPE.textbook))
        ? QUIZ_SCOPE.textbook : [];
    const rejected = quizScopeRejectedNames();
    return new Set(listed.filter(n => !rejected.has(n)));
}

// 分野・範囲の判定結果の使い回し（STAGES / COMPOUNDS は起動後は変わらない）。
// 分類は 1059 件で約 0.2 秒かかるので、クイズを開くたびに数え直さない
// 分類は 1059 件で約 0.2 秒かかるので、クイズを開くたびに数え直さない
let _quizTraitCache = null;

/** ライブラリの各エントリに field（分野）と scopeLevel（範囲 1〜3）を付ける */
function applyQuizTraits(lib, stageCount) {
    // ⚠ **検分の `×` もキーに入れる**（C2）。入れないと、`quiz-scope.json` の `survey` を
    //   直しても使い回しのほうが勝って**書いた ○× が効かない**（＝「仕組みがあるだけ」）
    const surveySig = [...quizScopeRejectedNames()].sort().join('|');
    if (!_quizTraitCache || _quizTraitCache.length !== lib.length ||
        _quizTraitCache.stageCount !== stageCount ||
        _quizTraitCache.surveySig !== surveySig) {
        // お題と**同じ構造**の別名エントリ（compounds.json 側の重複登録）も「教科書」に入れる。
        // 名前ではなく正準コードで照合する（別名で登録されていても取りこぼさない）
        const stageCodes = new Set();
        for (let i = 0; i < stageCount; i++) {
            if (lib[i] && lib[i].mol.atoms.length) stageCodes.add(canonicalCode(lib[i].mol));
        }
        const textbook = quizScopeTextbookNames();
        _quizTraitCache = lib.map((e, i) => {
            const heavy = e.mol.atoms.filter(a => a.element !== 'H').length;
            let level = 3;
            if (i < stageCount || textbook.has(e.name) ||
                (heavy > 0 && stageCodes.has(canonicalCode(e.mol)))) {
                level = 1;
            } else if (heavy > 0 && heavy <= QUIZ_NAMED_HEAVY_MAX && iupacName(e.mol)) {
                level = 2;
            }
            return { field: compoundFieldOf(e.mol), scopeLevel: level,
                     chainOutsideRing: longestChainOutsideRing(e.mol),
                     groups: compoundGroupsOf(e.mol) };
        });
        _quizTraitCache.stageCount = stageCount;
        _quizTraitCache.surveySig = surveySig;
    }
    lib.forEach((e, i) => {
        e.field = _quizTraitCache[i].field;
        e.scopeLevel = _quizTraitCache[i].scopeLevel;
        // 図の長さ（環の外の最長鎖）。クイズの出題プールだけがこれを見る（QUIZ_CHAIN_MAX）
        e.chainOutsideRing = _quizTraitCache[i].chainOutsideRing;
        // 官能基・骨格（E1）。URL からだけ指せる内部の軸（→ QUIZ_GROUPS）
        e.groups = _quizTraitCache[i].groups;
    });
    return lib;
}

// 出題用ライブラリ { name, series, target, mol, formula, field, scopeLevel } を構築する
function buildCompoundLibrary(game) {
    const entries = [
        ...STAGES.map(s => ({ name: s.name, series: s.series, target: s.target })),
        ...COMPOUNDS.map(c => ({ name: c.name, series: 'その他の有名化合物', target: c.target }))
    ];
    const lib = entries.map(e => {
        const mol = game.createTargetFromData({ target: e.target });
        return { name: e.name, series: e.series, target: e.target, mol, formula: game.computeMolecularFormula(mol) };
    });
    return applyQuizTraits(lib, STAGES.length);
}

/**
 * そのエントリが、いま選ばれている範囲・分野に入るか。
 *
 * ⚠ **図の長さの上限（QUIZ_CHAIN_MAX）もここで効く。** つまみではなく
 * 「クイズの出題プールの性質」として入れてある（→ QUIZ_CHAIN_MAX の説明）。
 * `entryInQuizScope` を通るのは「同じ化合物はどれ？」と命名クイズだけなので、
 * 名称呼び出し・書き出し練習・名称ライブラリには波及しない。
 *
 * @param ignoreSizeCap 上限を無視して判定する（**外した件数を数えるためだけ**の口。
 *                      出題側からは渡さない）
 */
function entryInQuizScope(entry, scopeValue, fieldValue, ignoreSizeCap) {
    if (!ignoreSizeCap && entry.chainOutsideRing > quizChainMax()) return false;
    if (entry.scopeLevel > quizScopeLevelOf(scopeValue || QUIZ_SCOPE_DEFAULT)) return false;
    if (fieldValue && fieldValue !== 'all' && entry.field !== fieldValue) return false;
    // 官能基・骨格（E1）。**つまみではなく URL から来る**ので引数で受けない
    // ——受けると呼び出し側4か所すべてに書き足すことになり、1か所忘れると黙ってずれる
    const group = quizGroupValue();
    if (group && !(entry.groups || []).includes(group)) return false;
    return true;
}

/**
 * 出題件数の行に足す但し書き。**外した件数と、代表の名前**を出す
 * （「ステアリン酸が出ない」を画面から読めるようにするため）
 */
function quizOversizedNote(names) {
    if (!names || !names.length) return '';
    // 名前は長いので、頭の「（」より前だけを見出しに使う（例: パルミチン酸ナトリウム（セッケン））
    const head = names.slice(0, 2).map(n => n.split('（')[0]).join('・');
    return ` ／ 鎖が長すぎる ${names.length} 件（${head}${names.length > 2 ? ' など' : ''}）は外してある`;
}

/**
 * いまの絞り込みの中で、**図の長さの上限だけを理由に外れた**ものの名前（重複は畳む）。
 *
 * ⚠ **黙って減らさないための口**。件数を画面（出題件数の行）に出すのに使う。
 * 範囲・分野・シリーズで外れたものは数えない（それらは選んだ本人が分かっている）。
 */
function quizOversizedNames(entries, scopeValue, fieldValue, seriesValue) {
    const seen = new Set();
    const out = [];
    entries.forEach(e => {
        if (!(e.chainOutsideRing > quizChainMax())) return;
        if (seriesValue && seriesValue !== 'all' && e.series !== seriesValue) return;
        if (!entryInQuizScope(e, scopeValue, fieldValue, true)) return;
        if (seen.has(e.name)) return;
        seen.add(e.name);
        out.push(e.name);
    });
    return out;
}

/**
 * 選択肢の答え合わせを塗る（2026-08-09）。**選んだものと正解の両方を画面に残す**。
 *
 * それまでは結果メッセージの文が色を変えるだけで、**どのボタンを押したのかが残らなかった**。
 * SNS 動画の検品で分かった（押した瞬間しか手がかりが無く、静止画にすると読み取れない）。
 * 学習面でも、間違えた直後に「自分は何を選んだか」が消えるのは具合が悪い。
 *
 * @param buttons  選択肢のボタン列
 * @param isRight  そのボタンが正解か（(btn) => boolean）
 * @param picked   ユーザーが押したボタン。分からなければ null
 */
/**
 * 答え合わせの塗り分けを消し、選択肢を押せる状態に戻す（2026-08-20）。
 *
 * **なぜ共通ヘルパーにするか。** 答え合わせのボタンには2種類ある——
 * 問題ごとに `innerHTML = ''` で作り直されるもの（命名クイズ・総数当て）と、
 * HTML に直書きされていて**居座る**もの（同じ化合物？の2択・立体異性体クイズの3択・
 * 同じ？違う？の2択）。後者は自分で消さないと、**前の問題で押したボタンの色が
 * 次の問題に残る**（ユーザー検品 2026-08-20:「前のQで選択した選択肢のマーカーが
 * 次のQに引き継がれている」）。
 *
 * 居座る3か所のうち2か所は最初から消していて、**同じ化合物？だけが書き忘れられていた**。
 * 同じ4行を3か所へ書き写すと、また1か所だけ忘れる形が残るので、ここ1つに寄せて
 * 3か所から呼ぶ。回帰テスト QS2 は、この関数を空にすると3か所とも赤くなることを見る。
 */
function clearQuizChoiceMarks(buttons) {
    [...buttons].forEach(b => {
        b.disabled = false;
        b.classList.remove('quiz-choice-right', 'quiz-choice-wrong',
            'quiz-choice-muted', 'quiz-choice-picked');
    });
}

function markQuizChoices(buttons, isRight, picked) {
    [...buttons].forEach(b => {
        b.disabled = true;
        // **選択肢そのものに装飾色が付いている場合がある**（立体異性体クイズは
        // 鏡像異性体＝青・別の立体異性体＝オレンジ）。答え合わせでは「押したもの」と
        // 「正解」だけが色の意味を持つべきなので、`quiz-choice-*` が装飾色に勝つように
        // CSS 側を書いてある（装飾色は `.sq-btn-*` クラスで、こちらは `!important`）。
        // 勝たせないと、**押していないオレンジのボタンが画面でいちばん目立ち、
        // そちらを選んだように見える**（2026-08-09 のユーザー検品で実際に誤読された）
        b.classList.remove('quiz-choice-right', 'quiz-choice-wrong', 'quiz-choice-muted', 'quiz-choice-picked');
        if (isRight(b)) {
            b.classList.add('quiz-choice-right');
            if (b === picked) b.classList.add('quiz-choice-picked');
        } else if (b === picked) {
            b.classList.add('quiz-choice-wrong');
        } else {
            b.classList.add('quiz-choice-muted');
        }
    });
}

// シリーズ選択ドロップダウンを構築する（初回のみ）
function populateSeriesSelect(selectEl, library) {
    if (selectEl.options.length > 0) return;
    const seriesList = [];
    library.forEach(e => {
        if (!seriesList.includes(e.series)) seriesList.push(e.series);
    });
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'すべて';
    selectEl.appendChild(all);
    seriesList.forEach(s => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        selectEl.appendChild(o);
    });
}

/**
 * 範囲（レベル）のドロップダウンを構築する（初回のみ）。既定は「教科書」。
 * 件数は**そのレベルまでで出題できる総数**を書く（選ぶ前に効き目が読める）
 */
function populateScopeSelect(selectEl, library) {
    if (!selectEl || selectEl.options.length > 0) return;
    QUIZ_SCOPE_LEVELS.forEach(s => {
        const n = library.filter(e => e.scopeLevel <= s.level).length;
        const o = document.createElement('option');
        o.value = s.value;
        o.textContent = `${s.label}・${n}件`;
        if (s.value === QUIZ_SCOPE_DEFAULT) o.selected = true;
        selectEl.appendChild(o);
    });
    selectEl.value = QUIZ_SCOPE_DEFAULT;
}

/**
 * 分野のドロップダウンを構築する（初回のみ）。
 * **選択肢のラベルに件数を書く**。とくに「その他」は分類器が分けられなかったもので、
 * ここに件数を出さないと分類の外れが画面から読めなくなる（発注書の指示）。
 * 件数は範囲の絞り込みとは無関係に**ライブラリ全件**で数える（分類器の成績を出すため）
 */
function populateFieldSelect(selectEl, library) {
    if (!selectEl || selectEl.options.length > 0) return;
    const count = {};
    library.forEach(e => { count[e.field] = (count[e.field] || 0) + 1; });
    const all = document.createElement('option');
    all.value = 'all';
    // 「出題範囲」の下でレベルの select と横に並ぶので、**どちらの軸か分かる文言にする**
    // （2026-08-20。ただの「すべて」だと、隣のレベルの「すべて」と見分けが付かない）
    all.textContent = `分野を問わない・${library.length}件`;
    selectEl.appendChild(all);
    QUIZ_FIELDS.forEach(f => {
        const o = document.createElement('option');
        o.value = f;
        o.textContent = (f === 'その他' ? 'その他（分類できなかったもの）' : f) + `・${count[f] || 0}件`;
        selectEl.appendChild(o);
    });
}

/**
 * ===== 人が触るつまみは「出題範囲」と「難易度」の2つだけ（2026-08-20・ユーザー決定） =====
 *
 * ユーザー原文:「崩し方は誤答の紛らわしさになります。直鎖を横一直線に書かない、回転している
 * など。**内部的には別パラメータでよいかもしれませんが、人間としては区別する必要がないと
 * 感じます。そもそもですが、人間側で、崩し方・紛らわしさのパラメータは無くてよいかも
 * しれません。出題範囲、難易度が選べるとわかりやすい**」
 *
 * そこで**畳むのは人が触る面だけ**にして、内部は2つのパラメータのまま残す:
 *
 * | 人が選ぶ | 内部 |
 * |---|---|
 * | 出題範囲 | レベル（`#*-scope`）＋分野（`#*-field`）… v1425 のまま |
 * | 難易度   | 崩し方（`strength` 0/1/2）＋誤答の紛らわしさ（`confuse` 0/1/2） |
 *
 * ⚠ **崩し方の `<select>`（`#quiz-strength` / `#naming-strength`）は消さずに隠す。**
 * 動画の台本4本（demos-quiz.json の V64・V67・V92／demos-isomer.json の V24／
 * demos-longform.json の L1）が `{"type":"select","selector":"#quiz-strength"}` で
 * 直接値を入れており、`tutorial.js` の `select` アクションは
 * `getBoundingClientRect()` が 0 でも `el.value` を入れて `change` を投げるので、
 * **隠したままでも台本は今までどおり動く**（`button` アクションも同じ作りで、
 * 「隠れたボタン（rect=0）はカーソル演出を省いてクリックだけ実行する」と書いてある）。
 * だから **`syncStrength()` は難易度の change からしか呼ばない**——
 * `nextQuestion()` から呼ぶと、台本が入れた強度を毎回上書きして台本が壊れる。
 *
 * ⚠ **段の名前に内部語（「強度2」）を出さない。**中身を知らなくても選べる言葉にする。
 */
const QUIZ_DIFFICULTY = [
    { value: 'easy',   label: 'やさしい',   strength: 0, confuse: 0,
      hint: '図は回すか裏返すだけ。答えとまぎらわしくない選択肢が並びます' },
    { value: 'normal', label: 'ふつう',     strength: 1, confuse: 1,
      hint: '主鎖を曲げた図が出ます。選択肢は分子式や官能基が近いものが並びます' },
    { value: 'hard',   label: 'むずかしい', strength: 2, confuse: 2,
      hint: '図を大きく崩します。o-/m-/p- や位置番号だけが違う、名前もそっくりな選択肢が並びます' }
];
const QUIZ_DIFFICULTY_DEFAULT = 'normal';

function quizDifficultyOf(value) {
    return QUIZ_DIFFICULTY.find(d => d.value === value) ||
           QUIZ_DIFFICULTY.find(d => d.value === QUIZ_DIFFICULTY_DEFAULT);
}

/** 難易度のドロップダウンを構築する（初回のみ）。既定は「ふつう」＝今までの標準 */
function populateDifficultySelect(selectEl) {
    if (!selectEl || selectEl.options.length > 0) return;
    QUIZ_DIFFICULTY.forEach(d => {
        const o = document.createElement('option');
        o.value = d.value;
        o.textContent = d.label;
        o.title = d.hint;
        if (d.value === QUIZ_DIFFICULTY_DEFAULT) o.selected = true;
        selectEl.appendChild(o);
    });
    selectEl.value = QUIZ_DIFFICULTY_DEFAULT;
}

/**
 * ===== 誤答の「紛らわしさ」を段で持つ（発注書 §2-3・B案） =====
 *
 * ユーザー原文:「**分子式が違っても紛らわしいものはあります**」。
 * したがって**同分子式に縛らない**（発注書 §1-2 の実測: 同分子式だけだと
 * 教科書レベルでは 14% でしか4択が成立しない）。同分子式は
 * **「紛らわしさの1つの根拠」であって唯一の根拠ではない**。
 *
 * 段（大きいほど紛らわしい）:
 *   4 … 同じ母体で o-/m-/p- だけが違う（o-クレゾール／m-クレゾール）
 *   3 … 数字を伏せると同じ名前＝位置番号だけが違う（2-メチルペンタン／3-メチルペンタン）
 *   2 … 分子式が同じで構造が違う（構造異性体）
 *   1 … 官能基の組み合わせが同じ（`findFunctionalGroups` の type 集合が一致）
 *   0 … それ以外
 *
 * ⚠ **段 3・4 は名前の字面で決めている。**このアプリはふだん
 * 「名前ではなく target から数える」（DESIGN_compound_coverage.md §2）が、
 * ここは**「人間が読み間違える」という現象そのものが字面の話**なので字面でよい。
 * 後から読む人が規約違反と受け取らないよう、理由をここに残す（発注書 §2-3 の指示）。
 * ⚠ 段 1・2 は構造から決めており、字面には一切触っていない。
 *
 * 「紛らわしい誤答」の定義（回帰テストの物差し）＝ **段 2 以上**。
 * ＝ 分子式を数えるだけでは切れない誤答。段 0・1 は分子式が違うので、
 * 図を読まなくても分子式を数えれば落とせる。
 */
const QUIZ_CONFUSE_TIER_MAX = 4;

/** o-/m-/p- を取り除いた母体名 */
function quizNameStem(name) {
    return String(name || '').replace(/^[omp]-/, '');
}
function quizHasOmpPrefix(name) {
    return /^[omp]-/.test(String(name || ''));
}
/** 位置番号を伏せた名前（2,3-ジメチルペンタン → #,#-ジメチルペンタン） */
function quizBlurDigits(name) {
    return String(name || '').replace(/[0-9]+/g, '#');
}

/** 官能基の組（type 集合）。エントリに覚えさせる＝1059件を何度も数え直さない */
function quizFunctionalKey(entry) {
    if (entry._fgKey === undefined) {
        let k = '';
        try {
            k = [...new Set(findFunctionalGroups(entry.mol).map(g => g.type))].sort().join(',');
        } catch (e) { k = ''; }
        entry._fgKey = k;
    }
    return entry._fgKey;
}

/** 誤答としての紛らわしさ（0〜4）。大きいほど人が迷う */
function quizDistractorTier(entry, cand) {
    if (!entry || !cand || entry.name === cand.name) return 0;
    const a = entry.name, b = cand.name;
    if (quizHasOmpPrefix(a) && quizHasOmpPrefix(b) && quizNameStem(a) === quizNameStem(b)) return 4;
    if (/[0-9]/.test(a) && quizBlurDigits(a) === quizBlurDigits(b)) return 3;
    if (entry.formula && entry.formula === cand.formula) return 2;
    const k = quizFunctionalKey(entry);
    if (k && k === quizFunctionalKey(cand)) return 1;
    return 0;
}

/**
 * 誤答を n 個選ぶ。難易度の `confuse` で**どの段を好むか**が変わる。
 *   confuse 0（やさしい）… 段が**低い**ものから（＝明らかに違う誤答）
 *   confuse 1（ふつう）  … 段2（同分子式）を頭に置き、**段3・4 は最後に回す**
 *                          ＝ 同分子式までは狙うが、o/m/p や位置番号違いの
 *                          そっくりさんは「ほかに材料が無いとき」しか使わない
 *   confuse 2（むずかしい）… 段が**高い**ものから（＝名前もそっくり）
 * ⚠ ふつうの重みを `min(t,2)` にすると、段3・4 が段2 と同点になって
 * 抽選で普通に選ばれてしまう（実測: そっくりな誤答が ふつう 15.6% ／ むずかしい 18.9%
 * で差がほぼ無かった）。**「頭打ち」ではなく「後回し」にすること。**
 * 先にシャッフルしてから安定ソートするので、**同じ段の中では毎回ちがう顔ぶれ**になる。
 */
function pickQuizDistractors(entry, cands, confuse, n = 3) {
    const rank = confuse <= 0 ? (t) => -t
        : confuse === 1 ? (t) => (t >= 3 ? 0.5 : t)
        : (t) => t;
    return shuffleArray(cands)
        .map(c => ({ c, t: quizDistractorTier(entry, c) }))
        .sort((x, y) => rank(y.t) - rank(x.t))
        .slice(0, n)
        .map(x => x.c);
}

/** 正準コード（エントリに覚えさせる）。4択で「構造が同じ別名」を外すのに使う */
function quizCanonicalOf(entry) {
    if (entry._code === undefined) entry._code = canonicalCode(entry.mol);
    return entry._code;
}

/* ===== タイムアタックの自己ベスト（2026-08-20） =====
 *
 * ⚠ **立体タイムアタックとは別のキーにする**（ユーザー決定「分ける」）。
 * 向こうの `chemAssemblerTimeAttack` は**分子名をキーに `{ms, moves}` を積む**形なので、
 * 「一定時間で何問」の記録を混ぜると、どちらの遊びの記録なのか読めなくなる。
 * こちらは遊びの名前（`same-compound`）をキーに `{correct, asked, limitMs}` を積む。
 */
const QUIZ_TA_KEY = 'chemAssemblerQuizTimeAttack';
const QUIZ_TA_MODE = 'same-compound';

/* ===== 初期時間と、逓減する加算（2026-08-26・ユーザー決定） =====
 *
 * ユーザー原文:「**初期時間20秒** / **加算の総量ではなく、正解数に応じて加算時間を
 * 減らしていく**」。⚠ 私が推した「加算の総量に上限」は採られていない。減らすのは
 * **加算そのもの**で、n 回目の正解には `3.0 − 0.2×(n−1)` 秒（0秒で床）を払う。
 *
 * ⚠ **初期時間はその後 30秒 に変わった**（2026-08-26・ユーザー原文「では30秒でやって
 * みましょう」）。20秒 で出した実測が**ゆっくり解く人に厳しすぎた**ため——
 * 6秒/問・正答率50% の人が **4問（約29秒）で終わって**しまい、逓減は正解数で刻むので
 * その人たちには届かない ＝ **遅い人の体験は初期時間だけで決まる**、という理由。
 *
 * **なぜ逓減で暴走が消えるのか**（実測の要約。道具は tools/quiz-time-census.mjs）:
 *   1問の収支は ＋（加算）−（考えた時間 ＋ 送りの 0.9/1.8秒）。加算が 3.0秒 固定だと
 *   **考えが 2.1秒 を切る人には毎問プラス**が乗り、残り時間が増え続けた
 *   （実測: 1.2秒/問・全問正解で 25問でも終わらず、残りが 60→80.8秒 に**増えた**）。
 *   加算が **0 に向かって減る**なら、どんなに速い人でも必ず「加算 < 1問の消費」に届く。
 *   ⚠ **床を正の値にすると暴走は戻る**（床 1.0秒 の実測: 0秒で答える相手は終わらない）
 *   ＝ 効いているのは「減らすこと」ではなく **「0 まで減らすこと」**。
 *
 * さらに床が 0 なので **払われうる加算の合計が有限**（24.0秒）＝
 * **どんな速さ・正答率でも 30.0＋24.0 ＝ 54.0秒 で必ず終わる**という上限がつく。
 * ⚠ この上限は「調和 3.0/n」では得られない（合計が発散するので、速いほど長引く）。
 * ⚠ **上限の数字はどこにも直書きしない**。初期時間を動かすと表示も検査も追随する
 *   （60秒 と書いて 145秒 走った事故は、同じ数字が2か所にあったのが原因）。
 */
const QUIZ_TA_LIMIT_MS = 30000;
const QUIZ_TA_BONUS_MS = 3000;         // 1回目の正解の加算
const QUIZ_TA_BONUS_STEP_MS = 200;     // 正解1回ごとに減る量（0秒で床）

/** n 回目（1 始まり）の正解に払う加算。0秒が床 */
function quizTimeAttackBonusMs(nthCorrect) {
    return Math.max(0, QUIZ_TA_BONUS_MS - QUIZ_TA_BONUS_STEP_MS * (nthCorrect - 1));
}

/** 加算が 0秒 になる最初の正解の回数（＝「ここから先は伸びない」を表示に出すための数） */
function quizTimeAttackZeroAt() {
    if (QUIZ_TA_BONUS_STEP_MS <= 0) return Infinity;
    return Math.ceil(QUIZ_TA_BONUS_MS / QUIZ_TA_BONUS_STEP_MS) + 1;
}

/** 払われうる加算の合計（有限であること自体が「必ず終わる」の根拠） */
function quizTimeAttackTotalBonusMs() {
    const zero = quizTimeAttackZeroAt();
    if (!isFinite(zero)) return Infinity;
    let sum = 0;
    for (let n = 1; n < zero; n++) sum += quizTimeAttackBonusMs(n);
    return sum;
}

/** 秒の表示（整数なら小数点を出さない）。⚠ 表示は必ずここを通す＝直書きしない */
function quizTaSec(ms) {
    if (!isFinite(ms)) return '∞';
    return ms % 1000 === 0 ? String(ms / 1000) : (ms / 1000).toFixed(1);
}

/* ⚠ **文言は定数から組み立てる**（2026-08-26）。以前はボタンに「（60秒）」と直書きされ、
 * `QUIZ_TA_LABEL` と index.html の2か所に同じ数字が別々に置かれていた ＝
 * **表示 60秒・実際 145秒**（実測）のずれを誰も検出できなかった。 */
const QUIZ_TA_LABEL =
    `⏱ タイムアタック（${quizTaSec(QUIZ_TA_LIMIT_MS)}秒＋正解ボーナス・最長 ` +
    `${quizTaSec(QUIZ_TA_LIMIT_MS + quizTimeAttackTotalBonusMs())}秒）`;

/** 逓減することを**黙ってやらない**ための説明。ボタンの下に出す */
/* ⚠ v1468: 末尾の「どれだけ速く解いても NN秒で終わります。」（21字）を落とした（ux-density §3-d）。
 * **すぐ上のボタン `QUIZ_TA_LABEL` が「最長 NN秒」と名乗っている** ＝ 同じ数字を2か所で言っていた。
 * ⚠ 逓減の 2数字（0.2秒ずつ減り／16問目）は **QD3 が名指しで見張っている**ので落とさない
 * （報告書の案「＋3秒（だんだん減り、合計 ＋24秒まで）」は QD3 の③に当たるので採らなかった）。 */
const QUIZ_TA_RULE =
    `正解ごとに ＋${quizTaSec(QUIZ_TA_BONUS_MS)}秒。加算は1問ごとに ` +
    `${quizTaSec(QUIZ_TA_BONUS_STEP_MS)}秒ずつ減り、${quizTimeAttackZeroAt()}問目からは 0秒` +
    `（合計 ${quizTaSec(quizTimeAttackTotalBonusMs())}秒まで）。`;

function readQuizTimeAttackRecord(mode) {
    try {
        const all = JSON.parse(localStorage.getItem(QUIZ_TA_KEY) || '{}') || {};
        return all[mode] || null;
    } catch (e) { return null; }
}

/** 正解数が多いほど良い記録。同数なら出題数が少ないほう（＝取りこぼしが少ない）を採る */
function updateQuizTimeAttackRecord(mode, correct, asked, limitMs) {
    const prev = readQuizTimeAttackRecord(mode);
    const isNew = !prev || correct > prev.correct ||
                  (correct === prev.correct && asked < prev.asked);
    if (!isNew) return { isNew: false, correct: prev.correct, asked: prev.asked };
    const rec = { correct, asked, limitMs, at: new Date().toISOString() };
    try {
        const all = JSON.parse(localStorage.getItem(QUIZ_TA_KEY) || '{}') || {};
        all[mode] = rec;
        localStorage.setItem(QUIZ_TA_KEY, JSON.stringify(all));
    } catch (e) { /* localStorage が使えない環境では黙って諦める */ }
    return { isNew: true, correct, asked };
}

// 配列をシャッフルした新しい配列を返す（Fisher–Yates）
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 崩し方の強度設定（0=弱: 回転・反転のみ / 1=標準 / 2=強）
// 崩し方の強さ。**伸長（結合長を変える）は使わない**（2026-08-09・ユーザー指摘
// 「崩し方は主鎖が折れ曲がっているもののほうがよい。一般に結合長は気にしない」）。
// 構造式は結合の長さを表していないので、伸ばした図は読み手に何も要求しない＝
// 練習にならない。**効くのは屈曲**（主鎖の形が変わるので、つながり方を追い直すことになる）。
// stretch* は 0 にしてあるだけで実装は残してある（別の用途で要るかもしれないため）。
const TRANSFORM_LEVELS = [
    { kekuleProb: 0.0, stretchPasses: 0, stretchProb: 0.0, maxStretchUnits: 1, bendPasses: 0, bendProb: 0.0 },
    { kekuleProb: 0.5, stretchPasses: 0, stretchProb: 0.0, maxStretchUnits: 1, bendPasses: 2, bendProb: 1.0 },
    { kekuleProb: 1.0, stretchPasses: 0, stretchProb: 0.0, maxStretchUnits: 2, bendPasses: 3, bendProb: 1.0 }
];

// トポロジーを変えずに表記だけを変える（回転・反転・ケクレ位相反転・橋結合の伸長）
function transformCompoundDepiction(target, strength = 1) {
    const conf = TRANSFORM_LEVELS[strength] || TRANSFORM_LEVELS[1];
    const atoms = target.atoms.map(a => ({ ...a }));
    const bonds = target.bonds.map(b => ({ ...b }));

    // 図から読み取れる立体（フィッシャーの十字・ハースの上下・C=Cのシス/トランス）。
    // これらは**画面上の絶対的な向き**で決まる規約なので、90°回転や左右反転で意味が変わる。
    // 変形のたびに読み直し、**変わっていない配置だけを採用する**（生成側の意図を信用しない）。
    // ユーザー報告: α-D-マンノースの比較で、90°回転した図が「同じ化合物」と誤判定された。
    // 実測では 185件中29件が回転で別の立体異性体の図になっていた（α-D-マンノースは30回中24回）
    // pts は座標だけの配列（{x, y}）で渡ってくるので、元素は元の atoms から引く。
    // ここで element を取り違えると読み取りが常に null になり、
    // 「立体が保存できない」と判断して**全候補を弾いてしまう**（実際に一度そうなった）
    const stereoSignature = (pts) => {
        if (typeof readAtomParityFromFischer !== 'function') return null;
        const mm = new Molecule();
        const ids = pts.map((p, i) => {
            const na = mm.addAtom(atoms[i].element, p.x, p.y);
            // ハースの面マークは座標に現れないデータなので復元する。
            // 忘れると環の立体が読めず、実際の描画より**甘い判定**になる
            // （createTargetFromData と同じ扱いにそろえる）
            const f = atoms[i].haworthFace;
            if (f === 1 || f === -1) na.haworthFace = f;
            return na.id;
        });
        bonds.forEach(b => mm.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
        const info = readStereoOf(mm);
        return info ? info.stereoCode : null;
    };
    const baseStereo = stereoSignature(atoms);
    // **読めなかったものを読めるようにもしない**（v1201）。null も1つの読みとして照合する。
    // v242 では「読める分子が別の立体異性体に化ける」だけを塞いだが、逆向きの事故があった:
    // 屈曲で主鎖を曲げると、それまで一直線で読めなかった C=C まわりが読めるようになり、
    // **元の図が何も言っていなかったシス／トランスを変形が勝手に決めてしまう**。
    // 同じ化合物を2回崩すと片方がシス・片方がトランスになりうるので、「同じ／違うクイズ」が
    // **別の立体異性体の図を並べて「同じ」と言う**ことになる（修正前の実測で 2-ヘキセン等10件）。
    // CLAUDE.md「未確定を確定させるのは整形モードのタップだけの仕事」と同じ原則
    const keepsStereo = (pts) => stereoSignature(pts) === baseStereo;

    // 1. 90°単位の回転（0〜3回）＋左右反転（剛体変換なのでシス/トランスは保存される）。
    //    フィッシャー・ハースは保存されないので、**立体の読みが変わらない向きだけ**から選ぶ
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const rigid = (turns, mirror) => atoms.map(a => {
        let x = a.x, y = a.y;
        for (let t = 0; t < turns; t++) {
            const nx = cx - (y - cy);
            const ny = cy + (x - cx);
            x = nx; y = ny;
        }
        if (mirror) x = 2 * cx - x;
        return { x, y };
    });
    const poses = [];
    for (let t = 0; t < 4; t++) for (const mir of [false, true]) poses.push({ t, mir });
    for (let i = poses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [poses[i], poses[j]] = [poses[j], poses[i]];
    }
    // 立体が読めない分子では、従来どおり必ず向きを変える（t=0かつ反転なしは選ばない）
    const allowed = poses.filter(p => baseStereo !== null || p.t > 0 || p.mir);
    for (const p of allowed) {
        const pts = rigid(p.t, p.mir);
        if (!keepsStereo(pts)) continue;
        pts.forEach((q, i) => { atoms[i].x = q.x; atoms[i].y = q.y; });
        break;
    }

    // 2. ベンゼン環があればケクレ位相を反転（環内の単⇔二重を入れ替え。同値な表記）
    const m = new Molecule();
    const added = atoms.map(a => m.addAtom(a.element, a.x, a.y));
    bonds.forEach(b => m.addBond(added[b.atom1Index].id, added[b.atom2Index].id, b.type));
    const arKeys = findAromaticBondKeys(m);
    if (arKeys.size > 0 && Math.random() < conf.kekuleProb) {
        const keyOf = (b) => {
            const id1 = added[b.atom1Index].id;
            const id2 = added[b.atom2Index].id;
            return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
        };
        const targets = bonds.filter(b => arKeys.has(keyOf(b)));
        const flip = () => targets.forEach(b => {
            b.type = (b.type === 1 ? 2 : 1);
            const mb = m.getBond(added[b.atom1Index].id, added[b.atom2Index].id);
            if (mb) mb.type = b.type;
        });
        flip();
        // 縮合環（ナフタレン等）では、芳香族結合を一律に反転すると環の共有原子が
        // 5本結合になってしまう（単環ならもう一方のケクレ構造として妥当）。
        // 妥当な場合のみ採用し、そうでなければ元に戻す（P9-5 夜間監査で発見）
        if (!m.atoms.every(a => isValencyValid(m, a.id))) flip();
    }

    // 配置が図として読めるかの判定。**原子どうしの距離だけでは足りない**。
    // 伸長で結合が2〜3マス分に伸びると、その線の途中に無関係な原子が乗ることがあり、
    // 「カルボキシ基のOが中心炭素に直接ついている」ように見える図が出る
    // （ユーザー報告。グリシンで実測500回中192回、原子が結合線の真上=0.0px に載っていた）。
    // 直交格子なので、線に乗るときは 0px、乗らなければ 42px 以上とほぼ二値になる
    const distToSegment = (p, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (L2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    // 配置の「読みにくさ」＝いちばん詰まっている隙間（原子どうし・原子と結合線の両方）
    const tightestGap = (pts) => {
        let g = Infinity;
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                g = Math.min(g, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
            }
        }
        for (const bd of bonds) {
            const A = pts[bd.atom1Index], B = pts[bd.atom2Index];
            for (let i = 0; i < pts.length; i++) {
                if (i === bd.atom1Index || i === bd.atom2Index) continue;
                g = Math.min(g, distToSegment(pts[i], A, B));
            }
        }
        return g;
    };
    // 合格ラインは絶対値ではなく「元の図と同じ読みやすさを保つ」こと。
    // ハース環のテンプレートは元から26pxの隙間を持つので（ライブラリ全185件中7件）、
    // 一律 27.3px を要求すると糖の問題だけ変形の選択肢が激減してしまう
    const gapFloor = Math.min(GRID_SIZE * 0.65, tightestGap(atoms.map(a => ({ x: a.x, y: a.y }))));
    // 伸長・屈曲でも同じ2条件を課す。屈曲は枝を90°回すので、
    // 不斉炭素のまわりの向きが変わって立体の読みが変わりうる
    const isReadableLayout = (pts) => tightestGap(pts) >= gapFloor - 0.001 && keepsStereo(pts);

    // 3. 橋結合の伸長（強度に応じて回数・距離が増える。重なる場合は行わない）
    for (let pass = 0; pass < conf.stretchPasses; pass++) {
        if (Math.random() >= conf.stretchProb || bonds.length === 0) continue;
        const adj = atoms.map(() => []);
        bonds.forEach((b, bi) => {
            adj[b.atom1Index].push({ to: b.atom2Index, bi });
            adj[b.atom2Index].push({ to: b.atom1Index, bi });
        });
        const reach = (start, excludeBi) => {
            const seen = new Set([start]);
            const stack = [start];
            while (stack.length) {
                const i = stack.pop();
                adj[i].forEach(e => {
                    if (e.bi === excludeBi || seen.has(e.to)) return;
                    seen.add(e.to);
                    stack.push(e.to);
                });
            }
            return seen;
        };
        const bridges = [];
        bonds.forEach((b, bi) => {
            if (!reach(b.atom1Index, bi).has(b.atom2Index)) bridges.push(bi);
        });
        if (bridges.length === 0) continue;
        const bi = bridges[Math.floor(Math.random() * bridges.length)];
        const b = bonds[bi];
        const side = reach(b.atom2Index, bi);
        const a1 = atoms[b.atom1Index];
        const a2 = atoms[b.atom2Index];
        const len = Math.hypot(a2.x - a1.x, a2.y - a1.y) || 1;
        const units = 1 + Math.floor(Math.random() * conf.maxStretchUnits);
        const dx = (a2.x - a1.x) / len * GRID_SIZE * units;
        const dy = (a2.y - a1.y) / len * GRID_SIZE * units;
        const moved = atoms.map((a, i) => side.has(i) ? { x: a.x + dx, y: a.y + dy } : { x: a.x, y: a.y });
        if (isReadableLayout(moved)) {
            moved.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
        }
    }

    // 4. 主鎖の屈曲（P9-4）: 橋結合を選び、その先の枝全体を結合点まわりに90°回転させる。
    //    「主鎖が一直線でない」描き方を作る（直交作図のまま曲げるので手書き感覚を保つ）。
    //    多重結合（sp2/sp の120°/180°作図）を含む枝は、慣習的な作図が崩れるため回さない。
    // 重原子が一直線に並んでいるか（屈曲したかどうかの判定に使う）
    const isCollinear = () => {
        const heavy = atoms.filter(a => a.element !== 'H');
        if (heavy.length < 3) return true;
        return new Set(heavy.map(a => Math.round(a.y))).size === 1 ||
               new Set(heavy.map(a => Math.round(a.x))).size === 1;
    };
    const tryBend = (requireBent) => {
        if (bonds.length === 0) return;
        const adj = atoms.map(() => []);
        bonds.forEach((b, bi) => {
            adj[b.atom1Index].push({ to: b.atom2Index, bi });
            adj[b.atom2Index].push({ to: b.atom1Index, bi });
        });
        const reach = (start, excludeBi) => {
            const seen = new Set([start]);
            const stack = [start];
            while (stack.length) {
                const i = stack.pop();
                adj[i].forEach(e => {
                    if (e.bi === excludeBi || seen.has(e.to)) return;
                    seen.add(e.to);
                    stack.push(e.to);
                });
            }
            return seen;
        };
        // 回転の軸になりうる結合: 橋（切ると2つに分かれる）かつ単結合
        const candidates = [];
        bonds.forEach((b, bi) => {
            if (b.type !== 1) return;
            const side2 = reach(b.atom2Index, bi);
            if (side2.has(b.atom1Index)) return; // 環内結合は対象外
            const side1 = reach(b.atom1Index, bi);
            [[b.atom1Index, side2], [b.atom2Index, side1]].forEach(([pivotIdx, movingSet]) => {
                // 回す側が1原子でも許す（P12-8。ユーザー指摘「結合が伸びただけの問題が出やすい」）。
                // 以前は2原子以上に限っていたため、**炭素3個の鎖（プロパン・ジメチルエーテル・
                // エチルアミン等）は曲げようがなく**、伸長だけの問題になっていた。
                // 端の1原子を90°回すのは「主鎖を曲げて描く」そのもので、教科書の書き方に沿う
                if (movingSet.size < 1 || movingSet.size === atoms.length) return;
                // 回す側に多重結合が含まれるなら見送る（120°/180°の作図を壊さない）
                const movingHasMultiple = bonds.some(bb => bb.type > 1 &&
                    movingSet.has(bb.atom1Index) && movingSet.has(bb.atom2Index));
                if (movingHasMultiple) return;
                candidates.push({ pivotIdx, movingSet });
            });
        });
        if (candidates.length === 0) return;
        // 候補と回転方向をランダム順に試し、重ならない曲げ方が見つかった時点で確定する
        const trials = [];
        candidates.forEach(cand => [1, -1].forEach(dir => trials.push({ cand, dir })));
        for (let i = trials.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [trials[i], trials[j]] = [trials[j], trials[i]];
        }
        for (const { cand, dir } of trials) {
            const pivot = atoms[cand.pivotIdx];
            const rotated = atoms.map((a, i) => {
                if (!cand.movingSet.has(i)) return { x: a.x, y: a.y };
                const rx = a.x - pivot.x;
                const ry = a.y - pivot.y;
                return { x: pivot.x - dir * ry, y: pivot.y + dir * rx }; // 90°回転
            });
            if (!isReadableLayout(rotated)) continue;
            if (requireBent) {
                // 曲げ直しの最終試行では、結果が一直線に戻る曲げ方は採用しない
                const before = atoms.map(a => ({ x: a.x, y: a.y }));
                rotated.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
                if (!isCollinear()) return;
                before.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
                continue;
            }
            rotated.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
            return;
        }
    };

    for (let pass = 0; pass < conf.bendPasses; pass++) {
        if (Math.random() >= conf.bendProb) continue;
        tryBend(false);
    }
    // 曲げたつもりが打ち消し合って一直線に戻ることがあるため、最後に一度だけ曲げ直す
    if (conf.bendPasses > 0 && isCollinear()) tryBend(true);

    return { atoms, bonds };
}

// 分子を指定SVG（.quiz-bonds / .quiz-atoms グループを持つ）に描画し、判定用Moleculeを返す
/**
 * 表示専用に、**直線に並んだメチレン鎖を畳んだ作図データ**を作る（レビュー項目25・第1段）。
 * `DESIGN_chain_condense.md` の決めごとに従う。**元の target は変えない**
 * （変えると正準コード・立体の読み・保存が全部ずれる）。
 *
 * 畳む条件: 重原子の隣がちょうど2つ・どちらも単結合の炭素・置換基なし・**3個以上**続く・
 * **一直線に並んでいる**。`-CH₂-` が2つのHを持つので**不斉炭素にはなりえず**、
 * 一直線なら環にもならない ＝ 立体を壊す心配がない。
 *
 * **ラベルに置き換えるだけでは図の幅は縮まらない**（両端の原子は元の座標のまま）。
 * 畳んだぶんだけ向こう側をまとめて手前に寄せる。曲がった鎖を対象外にしているのは、
 * この移動先が一意に決まらないため。
 *
 * 畳めるものが無ければ null（呼び出し側は元の target をそのまま描く）。
 */
/**
 * 畳める「まっすぐな -CH₂- の並び」を見つけるだけの関数（項目25。座標は動かさない）。
 *
 * **検出と変形を分けてあるのは、キャンバス側（第2段）が変形を要らないから。**
 * クイズの図（第1段）は「畳んだぶん向こう側を手前に寄せて幅を縮める」が、
 * キャンバスでは**原子を動かすと当たり判定がずれる**（そこにある原子をタップして編集する）。
 * キャンバス側は「隠してラベルを1枚置く」だけでよいので、検出だけを共有する。
 *
 * 返すのは `[{ run, a, b, ux, uy, len, comp }]`:
 *   run … 畳める CH₂ の添字（並び順）／a・b … 鎖の両端に付いている「鎖でない原子」
 *   ux,uy,len … a→b の向きと距離／comp … b 側の連結成分（寄せるときに動かす範囲）
 *
 * 畳む条件（1つでも外れたら畳まない）:
 *   重原子の隣がちょうど2つで両方とも単結合の炭素／`minRun` 個以上続く／
 *   **一直線に並んでいる**（曲がった鎖はどこへ折り返すか決まらない）／
 *   両端に鎖でない原子が付いている（分子の末端は畳まない）／**環でない**
 */
function findCondensableChainRuns(target, minRun = 3) {
    const atoms = target.atoms;
    const adj = atoms.map(() => []);
    target.bonds.forEach(b => {
        adj[b.atom1Index].push({ i: b.atom2Index, type: b.type });
        adj[b.atom2Index].push({ i: b.atom1Index, type: b.type });
    });
    const isPlainCH2 = i => atoms[i].element === 'C' && adj[i].length === 2 &&
        adj[i].every(n => n.type === 1);

    // 続いている CH₂ のかたまり（連結成分）を取り出し、1本の道として並べ直す
    const inRun = i => isPlainCH2(i);
    const nbrsInRun = i => adj[i].map(n => n.i).filter(inRun);
    const runs = [];
    const seen = new Set();
    for (let i = 0; i < atoms.length; i++) {
        if (!inRun(i) || seen.has(i)) continue;
        const comp = [i];
        seen.add(i);
        for (let k = 0; k < comp.length; k++) {
            nbrsInRun(comp[k]).forEach(j => {
                if (!seen.has(j)) { seen.add(j); comp.push(j); }
            });
        }
        // 端（かたまりの中での隣が1つ以下）から並べる。端が無ければ環なので畳まない
        const start = comp.find(j => nbrsInRun(j).length <= 1);
        if (start === undefined) continue;
        const path = [start];
        let prev = -1, cur = start;
        for (;;) {
            const next = nbrsInRun(cur).find(j => j !== prev);
            if (next === undefined) break;
            path.push(next); prev = cur; cur = next;
        }
        if (path.length >= minRun) runs.push(path);
    }
    if (!runs.length) return [];

    const found = [];
    for (const run of runs) {
        // 鎖の両端にぶら下がっている「鎖でない原子」を見つける
        const ends = [run[0], run[run.length - 1]];
        const outside = ends.map((e, k) => {
            const other = k === 0 ? run[1] : run[run.length - 2];
            return adj[e].map(n => n.i).find(j => j !== other && !run.includes(j));
        });
        if (outside.some(v => v === undefined)) continue; // 端が開いている（分子の末端）＝畳まない
        const [A, B] = outside;
        if (A === B) continue; // 環
        // 一直線か（A・鎖・B が同じ直線に並び、間隔が一定）
        const line = [A, ...run, B].map(i => atoms[i]);
        const dx = line[line.length - 1].x - line[0].x, dy = line[line.length - 1].y - line[0].y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const ux = dx / len, uy = dy / len;
        const straight = line.every(p => Math.abs((p.x - line[0].x) * uy - (p.y - line[0].y) * ux) < 1);
        if (!straight) continue;
        // B 側の連結成分（鎖を通らずに B から届く原子）。A へ回り込めるなら環なので畳まない
        const comp = new Set([B]);
        const stack = [B];
        let ring = false;
        while (stack.length) {
            const cur = stack.pop();
            for (const n of adj[cur]) {
                if (run.includes(n.i)) continue;
                if (n.i === A) { ring = true; break; }
                if (!comp.has(n.i)) { comp.add(n.i); stack.push(n.i); }
            }
            if (ring) break;
        }
        if (ring) continue;
        found.push({ run, a: A, b: B, ux, uy, len, comp: [...comp] });
    }
    return found;
}

/**
 * 畳んだ表示用の座標を作る（クイズの図・第1段）。**検出は findCondensableChainRuns に任せる。**
 * ここは「鎖を消して A–B を1本にし、**畳んだぶん B 側を手前へ寄せる**」変形だけを担当する。
 * 寄せないとラベルに置き換えても図の広がりが変わらない（設計書 DESIGN_chain_condense.md）。
 */
function condenseChainForDisplay(target, minRun = 3) {
    const found = findCondensableChainRuns(target, minRun);
    if (!found.length) return null;
    const atoms = target.atoms;
    const out = { atoms: atoms.map(a => Object.assign({}, a)), bonds: target.bonds.map(b => Object.assign({}, b)), labels: [] };
    const removed = new Set();
    let changed = false;

    for (const { run, a: A, b: B, ux, uy, len, comp } of found) {
        // 鎖を消して A–B を1本の結合にし、B 側を手前へ寄せる
        const step = Math.hypot(out.atoms[run[0]].x - out.atoms[A].x, out.atoms[run[0]].y - out.atoms[A].y);
        const shift = len - step * 2; // A と B のあいだをラベル1つぶん（刻み2つ）にする
        comp.forEach(i => { out.atoms[i].x -= ux * shift; out.atoms[i].y -= uy * shift; });
        run.forEach(i => removed.add(i));
        out.bonds = out.bonds.filter(b => !run.includes(b.atom1Index) && !run.includes(b.atom2Index));
        out.bonds.push({ atom1Index: A, atom2Index: B, type: 1 });
        const sub = String(run.length).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        out.labels.push({
            x: (out.atoms[A].x + out.atoms[B].x) / 2,
            y: (out.atoms[A].y + out.atoms[B].y) / 2,
            text: `(CH₂)${sub}`
        });
        changed = true;
    }
    if (!changed) return null;

    // 消した原子を詰めて、結合の添字を振り直す
    const map = new Map();
    const keptAtoms = [];
    out.atoms.forEach((a, i) => {
        if (removed.has(i)) return;
        map.set(i, keptAtoms.length);
        keptAtoms.push(a);
    });
    return {
        atoms: keptAtoms,
        bonds: out.bonds.filter(b => map.has(b.atom1Index) && map.has(b.atom2Index))
            .map(b => ({ atom1Index: map.get(b.atom1Index), atom2Index: map.get(b.atom2Index), type: b.type })),
        labels: out.labels
    };
}

/* ===== D/L の「基準になる不斉炭素」を図の中で指す（発注書 F-1・v1418） =====
 *
 * ユーザー申し立て: 「L・D判定 どのC原子が基準なのか（…）が分かるとよい」。
 * D/L は**基準になる不斉炭素が1つ**あって決まるのに、それが図のどこなのかが画面から読めなかった。
 * ⚠ **糖では不斉炭素が複数ある**（鎖状のグルコースは4つ）。基準はそのうち1つ
 * ——`assignDLDescriptor` が返す `centerId`（糖なら鎖の頭からいちばん遠い＝図のいちばん下）だけ。
 *
 * **語彙は「指し棒（引き出し線＋矢じり）」を新しく起こした。** 既存の語彙とは重ねない:
 *   ・**丸** … 「この原子が問題」（不斉マーク＝ピンク・エラー箇所）で埋まっている
 *              （`DESIGN_iupac_check.md` §3-1）。基準の炭素は「問題」ではないので使わない
 *   ・**帯** … 主鎖＝「この道」（オレンジ）で埋まっている。基準は道ではなく1点なので使わない
 *   ・色は**シアン**（`--color-cyan`）。ピンク（不斉）・オレンジ（主鎖・シス/トランス）・
 *     紫（立体ビューの α/β 面）・緑/赤（正誤）と、図に出る元素の色
 *     （C 灰・O 赤・N 青・S 黄・H 灰）のどれとも重ならない
 *
 * 指す向きは**基準の置換基と反対の側**から。そちら側には暗黙の H しか無い（中心から 16px）ので、
 * 矢じりを 24px 手前で止めれば字を潰さない。線は `.quiz-bonds`（原子より下の層）へ置くので、
 * 何かの上を通っても字が読めなくなることはない。
 *
 * ⚠ **いつ出すかは呼び出し側が決める**（この関数は「出す」しか知らない）。4択クイズでは
 * **答え合わせの後だけ**呼ぶ —— 出題中に基準を指すと、①系統を見分ける ②基準の炭素を探す の
 * 2段が消えて「左右を読む」だけの問題になる（とくに中心が4つあるグルコースでは問題が消える）。
 */
const DL_MARK_COLOR = 'var(--color-cyan, #00f2fe)';

function drawDLReferenceMark(game, svgId, target, opts = {}) {
    const svg = document.getElementById(svgId);
    if (!svg) return null;
    const mol = game.createTargetFromData({ target });
    const d = (typeof assignDLDescriptor === 'function') ? assignDLDescriptor(mol) : null;
    if (!d) return null;
    const center = mol.atoms.find(a => a.id === d.centerId);
    const ref = mol.atoms.find(a => a.id === d.refId);
    if (!center || !ref) return null;
    const bonds = svg.querySelector('.quiz-bonds');
    const labels = svg.querySelector('.cross-labels');
    if (!bonds || !labels) return null;

    const NS = 'http://www.w3.org/2000/svg';
    const vb = svg.viewBox.baseVal;
    // 基準の置換基が右にあるなら左から指す（＝置換基を隠さない）
    const fromLeft = ref.x > center.x;
    if (opts.pad) {
        // 説明の図だけ。札の文字ぶん、指す側の余白を広げる
        if (fromLeft) svg.setAttribute('viewBox', `${vb.x - opts.pad} ${vb.y} ${vb.width + opts.pad} ${vb.height}`);
        else svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width + opts.pad} ${vb.height}`);
    }
    const box = svg.viewBox.baseVal;
    const tipX = center.x + (fromLeft ? -24 : 24);
    const tailX = fromLeft ? box.x + 4 : box.x + box.width - 4;
    const dir = fromLeft ? 1 : -1;    // 矢じりの向き（＋なら右向き）
    const y = center.y;

    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', tailX); line.setAttribute('y1', y);
    line.setAttribute('x2', tipX - dir * 10); line.setAttribute('y2', y);
    line.setAttribute('stroke', DL_MARK_COLOR);
    line.setAttribute('stroke-width', '2.5');
    line.setAttribute('stroke-dasharray', '6 4');
    line.setAttribute('class', 'dl-ref-mark');
    bonds.appendChild(line);

    const head = document.createElementNS(NS, 'path');
    head.setAttribute('d', `M ${tipX} ${y} L ${tipX - dir * 13} ${y - 7} L ${tipX - dir * 13} ${y + 7} Z`);
    head.setAttribute('fill', DL_MARK_COLOR);
    head.setAttribute('class', 'dl-ref-mark');
    bonds.appendChild(head);

    if (opts.label) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', tailX + (fromLeft ? 2 : -2));
        t.setAttribute('y', y - 8);
        t.setAttribute('text-anchor', fromLeft ? 'start' : 'end');
        t.setAttribute('class', 'dl-ref-label');
        t.setAttribute('fill', DL_MARK_COLOR);
        t.textContent = opts.label;
        labels.appendChild(t);
    }
    return { centerId: d.centerId, x: center.x, y: center.y, letter: d.letter, kind: d.kind };
}

/**
 * @param condense 長い鎖を畳んで描くか（項目25・第1段）。**呼び出しごとに選ぶ**。
 * 「🎓 同じ化合物？」のように**図の形を見比べるのが問題そのもの**のクイズでは畳んではいけない。
 * あちらは主鎖をわざと曲げて出題するので、**曲がった側だけ畳まれず、同じ分子の2枚が
 * まったく違う絵になる**（畳む条件が「一直線」だから）。立体のクイズは向きを変えても
 * 一直線のままなので、そこでだけ畳む。
 */
function renderMoleculeIntoSvg(game, svgId, target, showWedge, condense) {
    const svg = document.getElementById(svgId);
    const bondsGroup = svg.querySelector('.quiz-bonds');
    const atomsGroup = svg.querySelector('.quiz-atoms');
    bondsGroup.innerHTML = '';
    atomsGroup.innerHTML = '';

    // 長い鎖は畳んで描く（レビュー項目25・第1段）。くさび図モードでは畳まない
    // （立体を見せる図なので中身を隠さない）。畳めるものが無ければ null で今までどおり
    const condensed = (condense && !showWedge) ? condenseChainForDisplay(target) : null;
    const drawn = condensed || target;
    const mol = game.createTargetFromData({ target: drawn });
    let hydrogens = mol.calculateHydrogens();
    if (showWedge) hydrogens = stretchStereoHydrogens(mol, hydrogens);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [...mol.atoms, ...hydrogens].forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 30;
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`);

    // くさび図モードでは、不斉炭素まわりの結合は**線ではなくくさび**で描く（下の drawWedges）
    const wedgeSet = showWedge ? wedgedBondKeys(mol, hydrogens) : null;
    const plain = (aId, bId) => !wedgeSet || !wedgeSet.has(aId + '|' + bId);

    hydrogens.forEach(h => {
        const parent = mol.atoms.find(a => a.id === h.parentId);
        if (parent && plain(h.parentId, 'H:' + h.x + ',' + h.y)) {
            game.renderTargetBond(parent.x, parent.y, h.x, h.y, 1, true, bondsGroup);
        }
    });
    mol.bonds.forEach(b => {
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (!a1 || !a2) return;
        if (!plain(b.atomId1, b.atomId2) || !plain(b.atomId2, b.atomId1)) return;
        game.renderTargetBond(a1.x, a1.y, a2.x, a2.y, b.type, false, bondsGroup);
    });
    if (showWedge) drawWedges(mol, hydrogens, bondsGroup);
    hydrogens.forEach(h => game.renderTargetAtom('H', h.x, h.y, atomsGroup));
    mol.atoms.forEach(a => game.renderTargetAtom(a.element, a.x, a.y, atomsGroup));
    // 畳んだ鎖の「(CH₂)ₙ」を、結合の上に台紙つきで置く（線と重なって読めなくならないように）
    if (condensed) {
        const NS = 'http://www.w3.org/2000/svg';
        condensed.labels.forEach(l => {
            const box = document.createElementNS(NS, 'rect');
            box.setAttribute('x', l.x - 30); box.setAttribute('y', l.y - 11);
            box.setAttribute('width', 60); box.setAttribute('height', 22);
            box.setAttribute('rx', 5);
            box.setAttribute('fill', 'rgba(15,20,28,0.95)');
            box.setAttribute('stroke', 'rgba(255,255,255,0.25)');
            atomsGroup.appendChild(box);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', l.x); t.setAttribute('y', l.y + 5);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'chain-condensed');
            t.textContent = l.text;
            atomsGroup.appendChild(t);
        });
    }
    return mol;
}

/**
 * くさび図モード（P12-8・項目17）で置き換える結合を集める。
 * フィッシャー投影は**縦が奥・横が手前**という規約を覚えていないと読めない。
 * その規約を図そのものに描き出して、脳内変換なしで立体を見比べられるようにする。
 * 対象は `readAtomParityFromFischer` が立体を読み取れた炭素の4本だけで、
 * **判定に使うのと同じ軸**（上下左右）から向きを決めるので、図とアプリの読みが食い違わない。
 */
function wedgedBondKeys(mol, hydrogens) {
    const keys = new Set();
    if (typeof readAtomParityFromFischer !== 'function') return keys;
    Object.keys(readAtomParityFromFischer(mol)).forEach(centerId => {
        mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H')
            .forEach(n => { keys.add(centerId + '|' + n.atom.id); keys.add(n.atom.id + '|' + centerId); });
        hydrogens.filter(h => h.parentId === centerId)
            .forEach(h => keys.add(centerId + '|H:' + h.x + ',' + h.y));
    });
    return keys;
}

/**
 * くさび図モードでだけ、不斉炭素の水素を重原子と同じ長さ（42px）まで伸ばす（表示専用）。
 * 通常の水素は 16px しかなく、そのままだと4本のうち1本だけくさびが 6px の豆粒になって、
 * 「4つの基が中心のまわりにどう並ぶか」を見る図にならない。
 * 伸ばした先に他の原子が来る図では**伸ばさない**（重なりを作ってまで揃えない）。
 */
function stretchStereoHydrogens(mol, hydrogens) {
    if (typeof readAtomParityFromFischer !== 'function') return hydrogens;
    const centers = Object.keys(readAtomParityFromFischer(mol));
    if (centers.length === 0) return hydrogens;
    const TARGET = 42, CLEAR = 20;
    return hydrogens.map(h => {
        if (centers.indexOf(h.parentId) < 0) return h;
        const c = mol.atoms.find(a => a.id === h.parentId);
        if (!c) return h;
        const dx = h.x - c.x, dy = h.y - c.y, len = Math.hypot(dx, dy);
        if (len < 1e-6 || len >= TARGET) return h;
        const nx = c.x + dx / len * TARGET, ny = c.y + dy / len * TARGET;
        const blocked = mol.atoms.some(a => a.id !== c.id && Math.hypot(a.x - nx, a.y - ny) < CLEAR)
            || hydrogens.some(o => o !== h && Math.hypot(o.x - nx, o.y - ny) < CLEAR);
        return blocked ? h : Object.assign({}, h, { x: nx, y: ny });
    });
}

/** 不斉炭素の4本を、手前＝塗りつぶしのくさび／奥＝破線のくさびで描く */
function drawWedges(mol, hydrogens, group) {
    if (typeof readAtomParityFromFischer !== 'function') return;
    const NS = 'http://www.w3.org/2000/svg';
    const FRONT = '#ffa502', BACK = '#78beff';
    Object.keys(readAtomParityFromFischer(mol)).forEach(centerId => {
        const c = mol.atoms.find(a => a.id === centerId);
        if (!c) return;
        const around = mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H')
            .map(n => ({ x: n.atom.x, y: n.atom.y }))
            .concat(hydrogens.filter(h => h.parentId === centerId).map(h => ({ x: h.x, y: h.y })));
        around.forEach(p => {
            const dx = p.x - c.x, dy = p.y - c.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return;
            const ux = dx / len, uy = dy / len;      // 中心→相手
            const nx = -uy, ny = ux;                  // 直交
            const front = Math.abs(dx) > Math.abs(dy); // 横＝手前 / 縦＝奥
            // 原子ラベルにかからないよう、両端を空ける（結合長は 16px〜42px）
            const near = Math.min(9, len * 0.28);
            const far = len - Math.min(11, len * 0.32);
            const half = Math.min(5, (far - near) * 0.35);
            if (far <= near) return;
            const at = (t, s) => [c.x + ux * t + nx * s, c.y + uy * t + ny * s];
            if (front) {
                const [x1, y1] = at(near, 0), [x2, y2] = at(far, half), [x3, y3] = at(far, -half);
                const tri = document.createElementNS(NS, 'polygon');
                tri.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
                tri.setAttribute('fill', FRONT);
                group.appendChild(tri);
            } else {
                // 奥は破線のくさび。手前から遠ざかるほど横棒が長くなる
                const steps = 4;
                for (let i = 0; i < steps; i++) {
                    const t = near + (far - near) * (i / (steps - 1 || 1));
                    const s = half * (0.35 + 0.65 * (i / (steps - 1 || 1)));
                    const [xa, ya] = at(t, s), [xb, yb] = at(t, -s);
                    const ln = document.createElementNS(NS, 'line');
                    ln.setAttribute('x1', xa); ln.setAttribute('y1', ya);
                    ln.setAttribute('x2', xb); ln.setAttribute('y2', yb);
                    ln.setAttribute('stroke', BACK);
                    ln.setAttribute('stroke-width', '2');
                    ln.setAttribute('stroke-linecap', 'round');
                    group.appendChild(ln);
                }
            }
        });
    });
}

// ===== 「同じ化合物はどれ？」クイズ（P8-3 ／ 2026-08-20 に4択へ） =====

/**
 * クイズの出題を外から指定するための読み取り（ORDER_stereo_puzzle.md の追加依頼・2026-08-03）。
 *
 * **なぜ要るか**: 「🎓 同じ化合物？」と立体異性体クイズは出題が乱数なので、SNS の収録が
 * 「答えを賭けて撮り、外れたら撮り直す」形になり、**1本あたり平均2テイク**かかっていた。
 * 系列（`#quiz-series`）と崩し方（`#quiz-strength`）は既に選べるので、
 * 足りないのは**答えを指定して出題する**入口だけ。
 *
 * **画面には出さない。** 入口の全体見直しが控えているので新しい UI は足さず、
 * URL パラメータ（`?quiz=same` / `?stereoQuiz=enantiomer`）と
 * `setForced()`、台本の `quizForce` アクションの3経路にとどめる。
 */
function readForcedFromUrl(key, allowed) {
    try {
        const v = new URLSearchParams(location.search).get(key);
        return allowed.includes(v) ? v : null;
    } catch (e) {
        return null;
    }
}

/**
 * ===== 「同じ化合物はどれ？」（P8-3 ／ 2026-08-20 に2択→4択へ作り替え） =====
 *
 * ユーザー決定（原文）:「**既存の同じ化合物はどれ　を　置き換えてよい**」
 * ＝ 2択（同じ／違う）をやめ、**見本1枚＋選択肢4枚から同じ化合物を1つ選ぶ**形にする。
 *
 * **器は作り直していない。** 選択肢のグリッドは立体の4択（`StereoChoiceQuiz`）が
 * 使っている `.pk-options` / `.pk-cell` / `.pk-badge` / `.pk-cell-right` /
 * `.pk-cell-wrong`（style.css）をそのまま借りている（発注書 §4-2）。
 *
 * **誤答の作り方は B案**（発注書 §1-4）。ユーザー補足「**分子式が違っても
 * 紛らわしいものはあります**」に従い、**同分子式に縛らない**——
 * §1-2 の実測で、同分子式だけだと教科書レベルでは 14% しか4択が成立しない。
 * 代わりに `pickQuizDistractors`（紛らわしさの段）で選ぶ。
 *
 * ⚠ **2択は消していない。** `setForced('same'/'diff')` か `setForcedPair(...)` が
 * 効いているあいだは2択の形で出す。理由は2つ:
 *   ・**「答えが 同じ／違う」の指定は2択でしか意味を持たない**（収録用の口）。
 *     動画の台本3本（V64・V92・V24）が `#btn-quiz-same` / `#btn-quiz-diff` を押す
 *   ・4択が作れない範囲（誤答の候補が3つ未満）でも出題を止めずに済む
 * ＝ 2択は「収録と保険の形」として生き続ける。画面の既定は4択。
 *
 * **正解は「実際に描かれた図」から `verifyMolecule` で決める**（発注書 §1-5）。
 * 誤答を作る側の意図は信用しない ＝ 崩し変換が偶然もとに戻っても取り違えない。
 * 正解がちょうど1つにならなかった問題は**捨てて作り直す**。
 */
class SameCompoundQuiz {
    constructor(game) {
        this.game = game;
        this.library = null;
        this.allPairs = null;     // 全ライブラリでの「違う」ペア [i, j]（2択用）
        this.poolIndices = null;  // 絞り込み後の出題インデックス
        this.pairs = null;        // 絞り込み後の「違う」ペア
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('quiz-modal');
        this.resultEl = document.getElementById('quiz-result');
        this.scoreEl = document.getElementById('quiz-score');
        this.btnSame = document.getElementById('btn-quiz-same');
        this.btnDiff = document.getElementById('btn-quiz-diff');
        this.seriesEl = document.getElementById('quiz-series');
        this.strengthEl = document.getElementById('quiz-strength');
        // 出題範囲の2軸（2026-08-20）。範囲＝高校で扱うか・分野＝大きなくくり
        this.scopeEl = document.getElementById('quiz-scope');
        this.fieldEl = document.getElementById('quiz-field');
        this.poolCountEl = document.getElementById('quiz-pool-count');
        // 人が触るつまみ（崩し方＋誤答の紛らわしさを畳んだもの）
        this.diffEl = document.getElementById('quiz-difficulty');
        // 4択の器と、2択（収録用）の器
        this.optionsEl = document.getElementById('quiz-options');
        this.pairFigEl = document.getElementById('quiz-pair-figure');
        this.pairRowEl = document.getElementById('quiz-pair-answer');
        this.goalLabelEl = document.getElementById('quiz-goal-label');
        this.cells = [0, 1, 2, 3].map(i => document.getElementById(`quiz-cell-${i}`));
        // 出題の指定（'same' / 'diff' / null）。null なら今までどおり乱数。
        // 収録が「答えを賭けて撮り、外れたら撮り直す」形になるのを止めるためのもの
        // （ORDER_stereo_puzzle.md の追加依頼。2026-08-03）
        this.forced = readForcedFromUrl('quiz', ['same', 'diff']);

        // タイムアタック（2026-08-20・ユーザー案「一定時間で何問解けるか」）
        this.taBtn = document.getElementById('btn-quiz-timeattack');
        this.taRowEl = document.getElementById('quiz-ta');
        this.taTimerEl = document.getElementById('quiz-ta-timer');
        this.taBestEl = document.getElementById('quiz-ta-best');
        this.taRuleEl = document.getElementById('quiz-ta-rule');
        // ⚠ ボタンと説明の文言は**ここで定数から入れる**（HTML に数字を直書きしない）
        if (this.taBtn) this.taBtn.textContent = QUIZ_TA_LABEL;
        if (this.taRuleEl) this.taRuleEl.textContent = QUIZ_TA_RULE;
        this.ta = null;
        this.taTimerId = null;
        this._advance = null;

        document.getElementById('btn-quiz').addEventListener('click', () => this.open());
        document.getElementById('btn-quiz-close').addEventListener('click', () => {
            this.stopTimeAttack(false);
            this.modal.classList.add('hidden');
        });
        document.getElementById('btn-quiz-next').addEventListener('click', () => this.nextQuestion());
        this.seriesEl.addEventListener('change', () => { this.computePools(); this.nextQuestion(); });
        [this.scopeEl, this.fieldEl].forEach(el => {
            if (el) el.addEventListener('change', () => { this.computePools(); this.nextQuestion(); });
        });
        this.strengthEl.addEventListener('change', () => this.nextQuestion());
        // ⚠ 崩し方への書き戻しは**ここからだけ**（nextQuestion からは呼ばない。
        // 呼ぶと台本が入れた `#quiz-strength` を毎回上書きして台本が壊れる）
        if (this.diffEl) {
            this.diffEl.addEventListener('change', () => { this.syncStrength(); this.nextQuestion(); });
        }
        this.btnSame.addEventListener('click', () => this.answer(true));
        this.btnDiff.addEventListener('click', () => this.answer(false));
        this.cells.forEach((cell, i) => {
            if (cell) cell.addEventListener('click', () => this.answerChoice(i));
        });
        if (this.taBtn) this.taBtn.addEventListener('click', () => this.toggleTimeAttack());
    }

    strength() {
        return Number(this.strengthEl.value);
    }

    difficulty() {
        return quizDifficultyOf(this.diffEl ? this.diffEl.value : QUIZ_DIFFICULTY_DEFAULT);
    }

    /** 難易度 → 崩し方（内部パラメータ）へ写す */
    syncStrength() {
        if (this.strengthEl) this.strengthEl.value = String(this.difficulty().strength);
    }

    /**
     * 2択（同じ／違う）の形で出すか。**画面の既定は4択**で、2択は
     * 「答えを指定して収録する」ときと、4択が作れないときの形として残してある
     */
    isPairForm() {
        return !!(this.forced || this.forcedPair);
    }

    open() {
        this.buildLibrary();
        populateSeriesSelect(this.seriesEl, this.library);
        populateScopeSelect(this.scopeEl, this.library);
        populateFieldSelect(this.fieldEl, this.library);
        populateDifficultySelect(this.diffEl);
        this.computePools();
        this.renderTimeAttackBest();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    buildLibrary() {
        if (this.library) return;
        this.library = buildCompoundLibrary(this.game);
        // 「違う」問題用ペア: 分子式が同じでトポロジーが異なる（構造異性体）。
        // 同一トポロジーの別名エントリ（幾何異性・別表記）は除外する
        this.allPairs = [];
        for (let i = 0; i < this.library.length; i++) {
            for (let j = i + 1; j < this.library.length; j++) {
                if (this.library[i].formula !== this.library[j].formula) continue;
                if (verifyMolecule(this.library[i].mol, this.library[j].mol)) continue;
                this.allPairs.push([i, j]);
            }
        }
        this.computePools();
    }

    // 範囲（レベル）・分野・シリーズの絞り込みを反映した出題プールを構築する
    computePools() {
        if (!this.library) return;
        const filter = this.seriesEl.value || 'all';
        const scope = (this.scopeEl && this.scopeEl.value) || QUIZ_SCOPE_DEFAULT;
        const field = (this.fieldEl && this.fieldEl.value) || 'all';
        this.poolIndices = this.library
            .map((e, i) => ((filter === 'all' || e.series === filter) &&
                            entryInQuizScope(e, scope, field)) ? i : -1)
            .filter(i => i >= 0);
        const idxSet = new Set(this.poolIndices);
        this.pairs = this.allPairs.filter(([i, j]) => idxSet.has(i) && idxSet.has(j));
        // 図の長さの上限で外れたもの（数だけ画面に出す。→ QUIZ_CHAIN_MAX）
        this.oversized = quizOversizedNames(this.library, scope, field, filter);
        // **絞った結果が空でも全体には戻さない**（戻すと「絞ったのに範囲外が出る」に化ける）。
        // 出題できないときは nextQuestion が断り文を出す
        this.renderPoolCount();
    }

    /** いま出題できる件数を画面に出す（絞り込みが効いたことを数で見せる） */
    renderPoolCount() {
        if (!this.poolCountEl) return;
        const n = this.poolIndices ? this.poolIndices.length : 0;
        this.poolCountEl.textContent = n === 0
            ? '⚠ この組み合わせでは出題できる化合物がありません' + quizGroupNote()
            : `いま出題できる: ${n} 件（うち「違う」に使える組 ${this.pairs.length} 組）` +
              quizGroupNote() + quizOversizedNote(this.oversized);
    }

    // 互換ラッパー（回帰テストから使用）
    get differentPairs() {
        return this.allPairs;
    }

    transformDepiction(target, strength = 1) {
        return transformCompoundDepiction(target, strength);
    }

    /**
     * 出題する2分子を名前で指定する（2026-08-09。収録用）。
     * `setForced('same'/'diff')` は**答え**を決めるだけで、**どの化合物が出るかは決まらない**。
     * 範囲を絞っても、C₆H₁₂O₆ のように候補が4件ある系列では狙いが定まらなかった
     * （グルコース対フルクトースを狙って、鎖状グルコース対環状グルコースが出た）。
     */
    setForcedPair(nameA, nameB) {
        this.forcedPair = (nameA && nameB) ? [nameA, nameB] : null;
    }

    setForced(v) {
        this.forced = (v === 'same' || v === 'diff') ? v : null;
    }

    /** 1問ぶんの素材を作る。描画はしない（指定どおりか確かめてから描くため） */
    buildTargets(wantSame, strength) {
        const lib = this.library;
        if (wantSame) {
            const idx = this.poolIndices[Math.floor(Math.random() * this.poolIndices.length)];
            const entry = lib[idx];
            return { entryA: entry, entryB: entry, targetA: entry.target,
                     targetB: transformCompoundDepiction(entry.target, strength) };
        }
        let [i, j] = this.pairs[Math.floor(Math.random() * this.pairs.length)];
        // 名前でペアを指定されていれば、それを優先する（収録用。setForcedPair の説明を参照）
        if (this.forcedPair) {
            const hit = this.pairs.find(([p, q]) =>
                (lib[p].name === this.forcedPair[0] && lib[q].name === this.forcedPair[1]) ||
                (lib[p].name === this.forcedPair[1] && lib[q].name === this.forcedPair[0]));
            if (hit) [i, j] = hit;
        }
        if (Math.random() < 0.5) [i, j] = [j, i];
        // どちらも表記変換して「見た目の乱れ具合」では判別できないようにする
        return { entryA: lib[i], entryB: lib[j],
                 targetA: transformCompoundDepiction(lib[i].target, strength),
                 targetB: transformCompoundDepiction(lib[j].target, strength) };
    }

    /** 出題の形（4択／2択）を画面に反映する */
    applyForm(pair) {
        if (this.optionsEl) this.optionsEl.classList.toggle('hidden', pair);
        if (this.pairFigEl) this.pairFigEl.classList.toggle('hidden', !pair);
        if (this.pairRowEl) this.pairRowEl.classList.toggle('hidden', !pair);
        if (this.goalLabelEl) this.goalLabelEl.textContent = pair ? '左の図' : '見本';
    }

    nextQuestion() {
        if (this._advance) { clearTimeout(this._advance); this._advance = null; }
        if (!this.poolIndices) this.computePools();
        if (!this.poolIndices || this.poolIndices.length === 0) {
            // 範囲・分野・シリーズを重ねると空になることがある（例: 教科書レベル×高分子）。
            // **全体に戻して出題しない**——絞ったのに範囲外が出るほうが害が大きい
            this.resultEl.textContent =
                'いまの絞り込み（範囲・分野・シリーズ' + (quizGroupValue() ? '・官能基' : '') +
                '）では出題できる化合物がありません。どれかを「すべて」に戻してください。';
            this.resultEl.className = '';
            this.renderPoolCount();
            return;
        }
        if (this.isPairForm()) return this.nextPairQuestion();
        if (this.nextChoiceQuestion()) return;
        // 4択が作れない範囲（誤答の候補が3つ未満）では2択で出す＝出題を止めない
        this.nextPairQuestion();
    }

    /**
     * 4択の素材を作る。描画はしない。
     * 誤答の候補は**出題プールの中**から取り、**構造が同じもの（別名の重複登録）は外す**
     * ——外さないと「正解が2つ」になる。
     */
    buildChoiceQuestion(strength, confuse) {
        const lib = this.library;
        const pool = this.poolIndices;
        // 候補は毎回同じなので、絞り込みが変わるまで使い回す
        if (!this._candCache || this._candCache.pool !== pool) {
            const seen = new Set();
            const list = [];
            pool.forEach(i => {
                const e = lib[i];
                if (!e.mol.atoms.length || seen.has(e.name)) return;
                seen.add(e.name);
                list.push(e);
            });
            this._candCache = { pool, list };
        }
        const cands = this._candCache.list;
        if (cands.length < 4) return null;
        for (let tries = 0; tries < 20; tries++) {
            const entry = cands[Math.floor(Math.random() * cands.length)];
            const goalCode = quizCanonicalOf(entry);
            const usable = cands.filter(e => quizCanonicalOf(e) !== goalCode);
            if (usable.length < 3) continue;
            const wrong = pickQuizDistractors(entry, usable, confuse, 3);
            if (wrong.length < 3) continue;
            const items = shuffleArray([{ entry, meant: true },
                ...wrong.map(e => ({ entry: e, meant: false }))]);
            return {
                entry, items,
                goalTarget: entry.target,
                targets: items.map(it => transformCompoundDepiction(it.entry.target, strength))
            };
        }
        return null;
    }

    /** 4択を1問出す。作れなければ false を返す（呼び手が2択へ落とす） */
    nextChoiceQuestion() {
        const strength = this.strength();
        const confuse = this.difficulty().confuse;
        let q = null, answer = -1;
        for (let tries = 0; tries < 6 && answer < 0; tries++) {
            const cand = this.buildChoiceQuestion(strength, confuse);
            if (!cand) return false;
            const goalMol = renderMoleculeIntoSvg(this.game, 'quiz-svg-a', cand.goalTarget);
            const mols = cand.targets.map((t, i) =>
                renderMoleculeIntoSvg(this.game, `quiz-opt-${i}`, t));
            // ⚠ **正解は描かれた図から決める**（発注書 §1-5）。生成側の意図は信用しない。
            // 正解がちょうど1つでなければ捨てて作り直す（「正解は1つだけ」の但し書き）
            const hits = mols.map((m, i) => verifyMolecule(goalMol, m) ? i : -1).filter(i => i >= 0);
            if (hits.length !== 1) continue;
            q = cand; answer = hits[0];
            q.goalMol = goalMol; q.mols = mols;
        }
        if (answer < 0) return false;
        this.applyForm(false);
        this.cells.forEach(cell => {
            if (cell) cell.classList.remove('pk-cell-right', 'pk-cell-wrong');
        });
        this.current = {
            form: 'choice',
            answer, answered: false,
            entry: q.entry,
            items: q.items,
            tiers: q.items.map(it => it.meant ? -1 : quizDistractorTier(q.entry, it.entry)),
            names: q.items.map(it => it.entry.name),
            formula: q.entry.formula,
            points: describeStructure(q.goalMol)
        };
        this.showPremise(q.goalMol, q.mols[answer]);
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.askedAt = Date.now();
        this.updateScore();
        return true;
    }

    /** 2択（収録用・保険）を1問出す。中身は 2026-08-20 より前のまま */
    nextPairQuestion() {
        const strength = this.strength();

        // 出題の指定があるときは、**作ったものが本当に指定どおりか `verifyMolecule` で
        // 確かめてから採用する**（生成の意図ではなく実際の関係で決める。
        // 「同じ？違う？」の StereoChoiceQuiz と同じ流儀）
        let built = null;
        for (let tries = 0; tries < 30 && !built; tries++) {
            const wantSame = this.pairs.length === 0 ? true
                : this.forced ? this.forced === 'same' : Math.random() < 0.5;
            const cand = this.buildTargets(wantSame, strength);
            if (!this.forced) { built = cand; break; }
            const a = this.game.createTargetFromData({ target: cand.targetA });
            const b = this.game.createTargetFromData({ target: cand.targetB });
            if (verifyMolecule(a, b) === (this.forced === 'same')) built = cand;
        }
        if (!built) {
            // 系列の絞り込みで「違う」の組が1つも無いときに起きる
            this.resultEl.textContent =
                `指定（${this.forced === 'same' ? '同じ' : '違う'}）で出題できる組が、いまの系列にありません。`;
            this.resultEl.className = '';
            return;
        }
        const { entryA, entryB, targetA, targetB } = built;

        this.applyForm(true);
        const molA = renderMoleculeIntoSvg(this.game, 'quiz-svg-a', targetA);
        const molB = renderMoleculeIntoSvg(this.game, 'quiz-svg-b', targetB);

        // 正解フラグは verifyMolecule で決める（生成ロジックのバグに対する防御）
        this.current = {
            form: 'pair',
            isSame: verifyMolecule(molA, molB),
            nameA: entryA.name,
            nameB: entryB.name,
            formula: entryA.formula,
            pointsA: describeStructure(molA),
            pointsB: describeStructure(molB)
        };
        this.showPremise(molA, molB);
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        // 押せる状態に戻すだけでなく、**前の問題の塗り分けも消す**（2026-08-20。
        // ここだけ書き忘れていて、選んだ選択肢の色が次の問題へ持ち越されていた）
        clearQuizChoiceMarks([this.btnSame, this.btnDiff]);
        this.askedAt = Date.now();
        this.updateScore();
    }

    /**
     * この問題が何を問うているかを図の上に出す（P12-8。ユーザー指摘）。
     * フィッシャー投影やハース図の問題と、ただの平面図の問題が混在していて、
     * **どの前提で解けばよいのか画面に書いていなかった**。
     * このクイズの正解は `verifyMolecule`＝つながり方だけで決まるので、
     * 立体（手前・奥）を読む必要が無いことをはっきり言う。
     */
    showPremise(molA, molB) {
        const el = document.getElementById('quiz-premise');
        if (!el) return;
        const readable = (mol) => {
            if (typeof readStereoOf !== 'function') return null;
            try { return readStereoOf(mol); } catch (e) { return null; }
        };
        const a = readable(molA), b = readable(molB);
        // 立体の種類を取り違えないこと。**シス/トランスはフィッシャーではない**
        // （シス-2-ブテンを「フィッシャー投影」と書いてしまった実例あり）。
        //   環のパリティ  → ハース図（環の上下）
        //   不斉炭素      → フィッシャー投影（縦が奥・横が手前）
        //   C=C の幾何のみ → シス・トランス
        const kindOf = (info) => {
            if (!info) return null;
            if (info.centers > 0) return info.fromRing ? 'ハース図（環の上下）' : 'フィッシャー投影（縦が奥・横が手前）';
            if (info.geoms > 0) return 'C=C のシス・トランス';
            return null;
        };
        const kind = kindOf(a) || kindOf(b);
        if (kind) {
            const what = kind === 'C=C のシス・トランス' ? 'シス・トランスの違い' : '手前・奥';
            el.textContent = `この図は${kind}を表せる形で描かれていますが、この問題で見るのは` +
                `「原子のつながり方が同じか」だけです。${what}は問いません。`;
        } else {
            el.textContent = '平面の構造式です。回っていても曲がっていても、' +
                '原子のつながり方が同じなら「同じ化合物」です。';
        }
    }

    /** 4択の答え合わせ */
    answerChoice(i) {
        const c = this.current;
        if (!c || c.form !== 'choice' || c.answered) return;
        c.answered = true;
        const ok = (i === c.answer);
        this.score.asked++;
        if (ok) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'same4', correct: ok });
        this.cells.forEach((cell, k) => {
            if (!cell) return;
            if (k === c.answer) cell.classList.add('pk-cell-right');
            else if (k === i) cell.classList.add('pk-cell-wrong');
        });
        const mark = '①②③④';
        const others = c.items.map((it, k) => k === c.answer ? null : `${mark[k]} ${it.entry.name}`)
            .filter(Boolean);
        let text = ok
            ? `⭕ 正解！ ${mark[c.answer]} が見本と同じ「${c.entry.name}」（分子式 ${c.formula}）です。`
            : `❌ 残念…正解は ${mark[c.answer]}「${c.entry.name}」（分子式 ${c.formula}）。` +
              `選んだ ${mark[i]} は「${c.items[i].entry.name}」（分子式 ${c.items[i].entry.formula}）でした。`;
        text += `\n構造のポイント: ${c.points.join('、')}`;
        text += `\nほかの3つ: ${others.join('・')}`;
        this.resultEl.textContent = text;
        this.resultEl.className = 'result-message ' + (ok ? 'success' : 'error');
        this.updateScore();
        this.afterTimeAttackAnswer(ok);
    }

    /** 2択の答え合わせ（収録用・保険の形） */
    answer(saidSame) {
        if (!this.current || this.current.form !== 'pair' || this.btnSame.disabled) return;
        markQuizChoices([this.btnSame, this.btnDiff],
            b => (b === this.btnSame) === this.current.isSame,
            saidSame ? this.btnSame : this.btnDiff);
        this.score.asked++;
        const correct = (saidSame === this.current.isSame);
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'same', correct: correct });

        const c = this.current;
        const head = correct ? '⭕ 正解！' : (c.isSame ? '❌ 残念…正解は「同じ」。' : '❌ 残念…正解は「違う」。');
        if (c.isSame) {
            this.resultEl.textContent =
                `${head} どちらも「${c.nameA}」（分子式 ${c.formula}）です。回転・反転・結合の長さや折れ曲がり・ベンゼンの二重結合の位置を変えても、原子のつながり方が同じなら同じ化合物です。\n` +
                `構造のポイント: ${c.pointsA.join('、')}`;
        } else {
            this.resultEl.textContent =
                `${head} 左は「${c.nameA}」、右は「${c.nameB}」。分子式はどちらも ${c.formula} ですが、原子のつながり方が異なる構造異性体です。\n` +
                `左: ${c.pointsA.join('、')}\n右: ${c.pointsB.join('、')}`;
        }
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
        this.afterTimeAttackAnswer(correct);
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }

    /* ===== タイムアタック（2026-08-20・ユーザー案） =====
     *
     * ユーザー原文:「**タイムアタックモード：一定時間で何問解けるか、（正解時に一定秒
     * 加算してもよい）**がおもしろいと思います。**種類を増やしすぎても煩雑になる**」
     * ＝ **「制限時間内に何問」の1種類だけ**。
     *
     * ⚠ `StereoTimeAttack` は流用していない（発注書 §4-1 の実測: あれはクイズではなく
     * フィッシャー投影の操作パズルで、借りられるのは計時と自己ベストの考え方だけ）。
     *
     * **正解ごとに加算**（1回目 ＋3秒。以後 0.2秒ずつ減って 16回目からは 0秒）。
     * ⚠ 加算は必ず画面に出す（`＋2.4秒` を出してから残りを描き直す）——黙って伸びると
     * 何が起きたのか分からない。⚠ **減っていることも出す**（`次の正解 ＋2.2秒`）——
     * 黙って減らすのは、黙って伸ばすのと同じくらい読めない。
     *
     * ⚠ **自己ベストは立体タイムアタックと別のキー**（ユーザー決定「分ける」）。
     * 向こうの `chemAssemblerTimeAttack` は**分子名をキーに積んでいる**ので、
     * 混ぜると「どの遊びの記録か」が読めなくなる。
     */
    toggleTimeAttack() {
        if (this.ta) this.stopTimeAttack(false);
        else this.startTimeAttack();
    }

    startTimeAttack() {
        this.score = { asked: 0, correct: 0 };
        // `bonusMs` は**1回目の加算**（以後は quizTimeAttackBonusMs が決める）。
        // `gained` は実際に払われた合計 ＝ 終わりの表示で「何秒走ったか」を出すのに使う
        this.ta = { limitMs: QUIZ_TA_LIMIT_MS, bonusMs: QUIZ_TA_BONUS_MS,
                    stepMs: QUIZ_TA_BONUS_STEP_MS, gained: 0,
                    endsAt: Date.now() + QUIZ_TA_LIMIT_MS, asked: 0, correct: 0, bonusText: '' };
        if (this.taBtn) this.taBtn.textContent = '■ やめる';
        if (this.taRowEl) this.taRowEl.classList.remove('hidden');
        this.renderTimeAttack();
        this.taTimerId = setInterval(() => this.tickTimeAttack(), 100);
        this.nextQuestion();
    }

    tickTimeAttack() {
        if (!this.ta) return;
        if (Date.now() >= this.ta.endsAt) this.stopTimeAttack(true);
        else this.renderTimeAttack();
    }

    renderTimeAttack() {
        if (!this.taTimerEl || !this.ta) return;
        const left = Math.max(0, this.ta.endsAt - Date.now());
        // ⚠ **次の正解でいくら伸びるか**を常に出す（逓減を黙ってやらない）
        const next = quizTimeAttackBonusMs(this.ta.correct + 1);
        const nextText = next > 0
            ? `次の正解 ＋${quizTaSec(next)}秒`
            : '加算はここまで（もう伸びません）';
        this.taTimerEl.textContent =
            `残り ${(left / 1000).toFixed(1)}秒 ／ ${this.ta.correct} 問正解（${this.ta.asked} 問）` +
            ` ／ ${nextText}` +
            (this.ta.bonusText ? `　${this.ta.bonusText}` : '');
    }

    /** 答え合わせのあと、タイムアタック中なら加算して次へ送る */
    afterTimeAttackAnswer(ok) {
        if (!this.ta) return;
        this.ta.asked++;
        if (ok) {
            this.ta.correct++;
            // **正解数に応じて逓減する**（ユーザー決定）。0秒が床なので合計は有限
            const add = quizTimeAttackBonusMs(this.ta.correct);
            this.ta.endsAt += add;
            this.ta.gained += add;
            // ⚠ 加算があったことを画面に出す（黙って伸ばさない）。0秒ならそう出す
            this.ta.bonusText = add > 0 ? `⏱ ＋${quizTaSec(add)}秒` : '⏱ ＋0秒（加算は使い切りました）';
        } else {
            this.ta.bonusText = '';
        }
        this.renderTimeAttack();
        this._advance = setTimeout(() => {
            if (this.ta) this.ta.bonusText = '';
            this.nextQuestion();
        }, ok ? 900 : 1800);
    }

    stopTimeAttack(finished) {
        if (this.taTimerId) { clearInterval(this.taTimerId); this.taTimerId = null; }
        if (this._advance) { clearTimeout(this._advance); this._advance = null; }
        const ta = this.ta;
        this.ta = null;
        if (this.taBtn) this.taBtn.textContent = QUIZ_TA_LABEL;
        if (!ta) return;
        const best = updateQuizTimeAttackRecord(QUIZ_TA_MODE, ta.correct, ta.asked, ta.limitMs);
        if (this.taTimerEl) {
            this.taTimerEl.textContent = finished
                ? `⏱ 終了！ ${quizTaSec(ta.limitMs)}秒＋ボーナス ${quizTaSec(ta.gained)}秒 ＝ ` +
                  `${quizTaSec(ta.limitMs + ta.gained)}秒で ${ta.correct} 問正解（${ta.asked} 問）`
                : `⏱ 中断しました（${ta.correct} 問正解 ／ ${ta.asked} 問）`;
        }
        if (finished && this.resultEl) {
            this.resultEl.textContent =
                `⏱ タイムアタック終了。${ta.correct} 問正解（出題 ${ta.asked} 問）でした。` +
                (best.isNew ? '\n🥇 自己ベスト更新！' : `\n自己ベスト: ${best.correct} 問正解`);
            this.resultEl.className = 'result-message success';
        }
        this.renderTimeAttackBest();
    }

    renderTimeAttackBest() {
        if (!this.taBestEl) return;
        const rec = readQuizTimeAttackRecord(QUIZ_TA_MODE);
        // ⚠ 遊び方（何秒・いくら加算）は #quiz-ta-rule に1か所だけ置く（数字を散らさない）
        this.taBestEl.textContent = rec
            ? `自己ベスト: ${rec.correct} 問正解（出題 ${rec.asked} 問）`
            : '自己ベスト: まだありません';
    }
}

// ===== 立体異性体クイズ（P12-8 M2.5） =====
//
// 「2つの図の関係は 同じ分子 / 鏡像異性体 / 別の立体異性体（ジアステレオマー）か」を答えさせる。
// **クイズの判定に CIP（R/S）は使わない**。P12-7 で作った立体コードの比較だけで足りる。
// ※ **判定そのものは実装済み**（`chemistry.js` の `cipRank` / `assignRSDescriptor`。
//    発注書 第4段 4b・v440）。ただしあれは**呼び名を出すため**のもので、
//    「同じ分子か」の同値関係には使わない ＝ ここは立体コードのままでよい。
//    2026-08-02 の方針変更（R/S を「やらないこと」から外した）に伴う書き換え。
// 立体コードの比較だけで判定できる理由:
//   立体コードが一致            → 同じ分子
//   片方の鏡像の立体コードが一致 → 鏡像異性体（エナンチオマー）
//   構造式は同じで上のどちらでもない → 別の立体異性体（ジアステレオマー）
// 出題は2通り。
//   (a) ライブラリの2エントリを並べる（D/L-アラニン、グルコース/ガラクトース、シス/トランスなど）
//   (b) 1つのエントリを**紙面内で回した図**と並べる。フィッシャー投影は
//       180°回すと同じ分子だが 90°回すと鏡像になる、という教科書の定番の落とし穴を
//       規則を書き込むのではなく「回した図から立体を読み直す」ことで自然に出す
// **正解は必ず、実際に描かれた2つの図から読んだ立体で決める**（生成側の意図は信用しない）。

// 立体が読める分子か調べ、読めたら記述子と立体コードを返す
function readStereoOf(mol) {
    if (typeof readAtomParityFromFischer !== 'function') return null;
    const atomParity = Object.assign({}, readAtomParityFromFischer(mol), readRingParityFromHaworth(mol));
    const bondGeo = readBondGeoFromCoords(mol);
    if (Object.keys(atomParity).length === 0 && Object.keys(bondGeo).length === 0) return null;
    const stereo = { atomParity, bondGeo };
    return {
        stereo,
        code: canonicalCode(mol),
        stereoCode: canonicalStereoCode(mol, stereo),
        mirrorCode: canonicalStereoCode(mol, mirrorStereo(stereo)),
        centers: Object.keys(atomParity).length,
        geoms: Object.keys(bondGeo).length,
        fromRing: Object.keys(readRingParityFromHaworth(mol)).length > 0
    };
}

/**
 * シス/トランスのある C=C を、直交作図（90°）ではなく **±120°** に整えた target を返す（P12-8）。
 * 作図モードの「⇄ シス/トランス整形」と同じ処理（game.reshapeDoubleBond）を、
 * 出題データに対して使う。実際の sp2 の形に近く、シス/トランスが読み取りやすくなる。
 * **整形で幾何が変わってしまった場合は元のまま返す**（見た目の調整で分子が変わってはいけない）。
 */
function reshapeGeometryForDisplay(game, target) {
    if (typeof bondGeoRefs !== 'function') return target;
    const mol = game.createTargetFromData({ target });
    const geoBonds = mol.bonds.filter(b => bondGeoRefs(mol, b));
    if (geoBonds.length === 0) return target;
    const before = readBondGeoFromCoords(mol);
    const saved = game.userMolecule;
    game.userMolecule = mol; // reshapeDoubleBond は userMolecule を見る
    try {
        geoBonds.forEach(b => {
            const subs = (id, other) => mol.getNeighbors(id)
                .filter(n => n.atom.id !== other && n.atom.element !== 'H')
                .map(n => n.atom);
            game.reshapeDoubleBond(b, subs(b.atomId1, b.atomId2), subs(b.atomId2, b.atomId1));
        });
    } catch (e) {
        game.userMolecule = saved;
        return target;
    }
    game.userMolecule = saved;
    const after = readBondGeoFromCoords(mol);
    const changed = Object.keys(before).some(k => before[k] !== after[k]) ||
        Object.keys(after).length !== Object.keys(before).length;
    if (changed) return target; // 幾何が変わったら採用しない
    return {
        atoms: target.atoms.map((a, i) => Object.assign({}, a,
            { x: Math.round(mol.atoms[i].x), y: Math.round(mol.atoms[i].y) })),
        bonds: target.bonds.map(b => Object.assign({}, b))
    };
}

// target（データ）を紙面内で回した／鏡に映した新しい target を返す（座標だけを変える）
function rotateTargetInPlane(target, quarterTurns, mirrorX = false) {
    const cx = target.atoms.reduce((s, a) => s + a.x, 0) / target.atoms.length;
    const cy = target.atoms.reduce((s, a) => s + a.y, 0) / target.atoms.length;
    const rot = ((quarterTurns % 4) + 4) % 4;
    const atoms = target.atoms.map(a => {
        let dx = a.x - cx, dy = a.y - cy;
        for (let i = 0; i < rot; i++) { const t = dx; dx = -dy; dy = t; } // 90°ずつ
        if (mirrorX) dx = -dx;
        return Object.assign({}, a, { x: Math.round(cx + dx), y: Math.round(cy + dy) });
    });
    return { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
}

/**
 * target（データ）を**上下に裏返した**新しい target を返す（DESIGN_sugar.md §1-2 の②）。
 * y を折り返し、**面マーク（`haworthFace`）も一緒に反転**する。
 *
 * ⚠ `rotateTargetInPlane` には裏返しが無い（あちらは回転と左右の鏡映だけ）。
 * ハース投影で「同じ分子のまま置き直せる」非自明な操作はこれ1つで、
 * 面（上下）と番号をたどる向きが**同時に**逆になるので掛け合わせた読みが保たれる。
 * ⚠ 面マークを直し忘れると、マークを持つ登録8件だけが鏡像に化ける（§1-3 の⑤）。
 *
 * ⚠⚠ **その「直し忘れ」を出題の罠には使えない。** マークは画面に描かれない（`renderTargetAtom`）
 * ので、直し忘れた図は**正しく裏返した図と1画素も違わない絵**になる ＝ 見て選べない。
 * §1-3 が「8件のマークはどれも冗長（同じ値が縦位置からも読める）」と実測しているのと同じこと。
 */
function flipTargetVertically(target) {
    const cy = target.atoms.reduce((s, a) => s + a.y, 0) / target.atoms.length;
    return {
        atoms: target.atoms.map(a => {
            const o = Object.assign({}, a, { y: Math.round(2 * cy - a.y) });
            if (o.haworthFace === 1 || o.haworthFace === -1) o.haworthFace = -o.haworthFace;
            return o;
        }),
        bonds: target.bonds.map(b => Object.assign({}, b))
    };
}

/**
 * ★ **キャンバスの帯にある3つの札（⇅・⇄・⟳）を、出題データ（target）に当てる。**
 * 採点のあとで「解説のとおりになるか、自分の手で確かめる」ための道具
 * （ユーザー発注 2026-08-26。DESIGN_sugar.md §1-2c ＝ ハース図で意味を保つ図は4枚ある）。
 *
 * ⚠ **新しい置き直しは1つも書いていない。** 実体は `chemistry.js` の
 *   `flipHaworth`（⇅）と `haworthTurn`（⇄・⟳）そのもので、門番も
 *   `haworthFlipPlan` / `canFlipHaworth` / `haworthTurnPlan` をそのまま借りる。
 *   ここがやっているのは **mol ⇔ target の受け渡し**（クイズは target を、
 *   キャンバスの札は Molecule を扱うので、その差だけを埋めている）。
 *
 * ⚠ **⇅ は分子まるごとに当てる**（`game.flipWholeHaworth` と同じ約束）。
 *   `haworthFlipPlan().ids` は二糖では**片方の環だけ**を指すので、そこは借りず
 *   **門番 `.ok` だけ**を借りる（v1449 で禁止した「片方の環だけ裏返す」を復活させない）。
 *
 * ⚠ **最後の関所も帯と同じ**: 当てたあとに図から立体コードを読み直し、
 *   元と食い違ったら `null` を返す（黙って鏡像の図を作らない）。登録16件は全部通る。
 *
 * kind: 'updown' | 'leftright' | 'halfturn'。当てられなければ null。
 */
function haworthTurnedTarget(game, target, kind) {
    if (typeof haworthFlipPlan !== 'function' || typeof haworthTurnPlan !== 'function') return null;
    const mol = game.createTargetFromData({ target });
    if (!mol.atoms.length) return null;
    const print0 = game.haworthStereoFingerprint(mol);
    if (kind === 'updown') {
        if (!haworthFlipPlan(mol).ok) return null;              // 門番だけ借りる（ids は借りない）
        const ids = mol.atoms.map(a => a.id);
        if (!canFlipHaworth(mol, ids)) return null;
        const heavy = mol.atoms.filter(a => a.element !== 'H');
        const list = heavy.length ? heavy : mol.atoms;
        flipHaworth(mol, ids, list.reduce((t, a) => t + a.y, 0) / list.length);
    } else if (kind === 'leftright' || kind === 'halfturn') {
        const plan = haworthTurnPlan(mol);
        if (!plan.ok) return null;
        if (!haworthTurn(mol, plan, kind)) return null;
    } else {
        return null;
    }
    if (game.haworthStereoFingerprint(mol) !== print0) return null;   // ★ 最後の関所
    return {
        atoms: target.atoms.map((a, i) => {
            const o = Object.assign({}, a,
                { x: Math.round(mol.atoms[i].x), y: Math.round(mol.atoms[i].y) });
            const f = mol.atoms[i].haworthFace;
            if (f === 1 || f === -1) o.haworthFace = f; else delete o.haworthFace;
            return o;
        }),
        bonds: target.bonds.map(b => Object.assign({}, b))
    };
}

class StereoQuiz {
    constructor(game) {
        this.game = game;
        this.pool = null;      // 立体が読めるエントリ
        this.pairs = null;     // ライブラリ内の [i, j]（構造式が同じ立体異性体の組）
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('stereo-quiz-modal');
        this.resultEl = document.getElementById('sq-result');
        this.scoreEl = document.getElementById('sq-score');
        this.buttons = {
            same: document.getElementById('btn-sq-same'),
            enantiomer: document.getElementById('btn-sq-enantiomer'),
            diastereomer: document.getElementById('btn-sq-diastereomer')
        };
        // 出題範囲（P12-8 M2.5・ユーザー要望）。フィッシャー投影を回す問題は
        // 規約（縦=奥・横=手前）を理解していないと解けないので、既定では出さず
        // 「発展」を選んだときだけ出す
        this.modeEl = document.getElementById('sq-mode');
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.nextQuestion());
        // 出題の指定（'same' / 'enantiomer' / 'diastereomer' / null）。→ readForcedFromUrl の説明
        this.forced = readForcedFromUrl('stereoQuiz', ['same', 'enantiomer', 'diastereomer']);
        // M2.5-A 重ね合わせビュー: 解答後に図Bのゴーストを図Aへ平行移動して重ね、
        // 立体の一致/不一致を中心ごとに示す（対応づけは座標ではなく正準ラベリング）
        this.overlayBtn = document.getElementById('btn-sq-overlay');
        this.overlayNoteEl = document.getElementById('sq-overlay-note');
        if (this.overlayBtn) this.overlayBtn.addEventListener('click', () => this.toggleOverlay());
        const btn = document.getElementById('btn-stereo-quiz');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-sq-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-sq-next').addEventListener('click', () => this.nextQuestion());
        Object.keys(this.buttons).forEach(k => this.buttons[k].addEventListener('click', () => this.answer(k)));
    }

    open() {
        this.build();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    build() {
        if (this.pool) return;
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info) this.pool.push(Object.assign({}, e, info));
        });
        // 構造式が同じ組だけを集める（分子が違えば立体の話にならない）
        this.pairs = [];
        for (let i = 0; i < this.pool.length; i++) {
            for (let j = i + 1; j < this.pool.length; j++) {
                if (this.pool[i].code !== this.pool[j].code) continue;
                if (this.pool[i].stereoCode === this.pool[j].stereoCode) continue; // 同名の重複エントリは使わない
                this.pairs.push([i, j]);
            }
        }
    }

    /** 2つの分子の関係を、描かれた図から読んだ立体だけで判定する */
    static relationOf(molA, molB) {
        const a = readStereoOf(molA);
        const b = readStereoOf(molB);
        if (!a || !b) return null;
        if (a.code !== b.code) return 'constitution'; // つながり方が違う（この問題では出さない）
        if (a.stereoCode === b.stereoCode) return 'same';
        if (a.mirrorCode === b.stereoCode) return 'enantiomer';
        return 'diastereomer';
    }

    // 出題候補を作る（回した図 or ライブラリの別エントリ）。作れなければ null
    makeCandidate() {
        // 「図を回す」出題は**フィッシャー投影（非環）に限る**。
        // ハース投影で紙面内180°回すと、規約どおりに読めば面が上下逆になり鏡像を描いた図に
        // なってしまう。理屈は同じだが教科書で扱う話ではなく、混乱を招くだけなので出さない
        // （環の分子はライブラリのペア＝α/βアノマー・エピマーで十分よい問題になる）
        const mode = this.modeEl ? this.modeEl.value : 'all';
        // くさび図モード（項目17・18）は**不斉炭素1個の鎖状分子**だけに絞る。
        // 面マークを描いても、中心が2つ以上あればジアステレオマーの読み分けが要り、
        // 「手前と奥が入れ替わったか」だけを見る練習にならない
        const wedge = mode === 'wedge';
        const inScope = (e) => !wedge || (e.centers === 1 && !e.fromRing && e.geoms === 0);
        const flat = this.pool.filter(e => !e.fromRing && inScope(e));
        const pairs = wedge
            ? this.pairs.filter(([i, j]) => inScope(this.pool[i]) && inScope(this.pool[j]))
            : this.pairs;
        // くさび図モードでライブラリのペアを使わないのは、**答えが偏るから**。
        // 不斉炭素1個の分子どうしで構造式が同じなら関係は鏡像異性体しかありえず、
        // しかも該当する組は D/L の3組だけ。混ぜると「いつも鏡像」で8割当たってしまう
        // （実測: same 23 / enantiomer 97）。回した図だけにすると 42% / 58% に落ち着く
        const canPair = pairs.length > 0 && mode !== 'transform' && !wedge;
        const canTransform = flat.length > 0;
        if (!canPair && !canTransform) return null;
        const useLibraryPair = canPair && (!canTransform || Math.random() < 0.5);
        if (useLibraryPair) {
            let [i, j] = pairs[Math.floor(Math.random() * pairs.length)];
            if (Math.random() < 0.5) [i, j] = [j, i];
            return { targetA: this.pool[i].target, targetB: this.pool[j].target,
                     nameA: this.pool[i].name, nameB: this.pool[j].name, how: 'pair' };
        }
        // 紙面内の回転・鏡映。どれを選ぶと何になるかは判定側に任せる。
        // 標準では **180°回転だけ**（＝同じ分子。フィッシャーの規約を知らなくても
        // 「回しただけ」と分かる）。90°回転や鏡映は規約の理解が要るので発展に回す。
        // 標準にも回転問題を混ぜるのは、ライブラリのペアだけだと
        // 「同じ分子」が正解になる問題が1つも出ないため（ST15 で検出）
        const pick = flat[Math.floor(Math.random() * flat.length)];
        const turns = mode === 'pair' ? 2 : [0, 1, 2, 3][Math.floor(Math.random() * 4)];
        const mirror = mode === 'pair' ? false : Math.random() < 0.35;
        if (turns === 0 && !mirror) return null; // まったく同じ図は出さない
        return { targetA: pick.target, targetB: rotateTargetInPlane(pick.target, turns, mirror),
                 nameA: pick.name, nameB: pick.name, how: 'transform', turns, mirror,
                 // 分子そのものがアキラルか（立体コードと鏡像のコードが一致する）。
                 // 「鏡映したのに同じ」の理由がアキラルとは限らない（回転と鏡映が
                 // 打ち消し合っただけのことがある）ので、ここを取り違えないための材料
                 achiral: pick.stereoCode === pick.mirrorCode };
    }

    /** 出題を指定する（'same' / 'enantiomer' / 'diastereomer'、null で解除） */
    setForced(v) {
        this.forced = ['same', 'enantiomer', 'diastereomer'].includes(v) ? v : null;
    }

    nextQuestion() {
        this.build();
        let q = null;
        // 指定つきのときは試行を増やす。狙った関係が出る確率はまちまちで
        // （例: くさび図モードで「同じ」は 42%）、60回では取りこぼしうる
        const maxTries = this.forced ? 400 : 60;
        for (let tries = 0; tries < maxTries && !q; tries++) {
            const cand = this.makeCandidate();
            if (!cand) continue;
            const molA = this.game.createTargetFromData({ target: cand.targetA });
            const molB = this.game.createTargetFromData({ target: cand.targetB });
            const rel = StereoQuiz.relationOf(molA, molB);
            // 立体が読めなくなった図・つながり方が違う組は出題しない
            if (!rel || rel === 'constitution') continue;
            // 出題の指定（→ readForcedFromUrl の説明）。**生成の狙いではなく
            // 実際に読み直した関係で絞る**ので、回転と鏡映が打ち消し合った図も取り違えない
            if (this.forced && rel !== this.forced) continue;
            q = Object.assign({}, cand, { rel, molA, molB });
        }
        if (!q) {
            const label = { same: '同じ分子', enantiomer: '鏡像異性体', diastereomer: '別の立体異性体' };
            this.resultEl.textContent = this.forced
                ? `指定（${label[this.forced]}）で出題できる組が、いまの出題範囲にありません。`
                : '出題できる立体異性体の組が見つかりませんでした。';
            return;
        }
        // 重ね合わせ表示は問題ごとにリセット（M2.5-A）
        this.clearOverlay();
        this._overlayPlan = undefined;
        if (this.overlayBtn) this.overlayBtn.classList.add('hidden');
        // シス/トランスのある C=C は120°に整えてから描く（P12-8。ユーザー要望）
        const wedge = !!(this.modeEl && this.modeEl.value === 'wedge');
        const legend = document.getElementById('sq-wedge-legend');
        if (legend) legend.classList.toggle('hidden', !wedge);
        // 描いたとおりの分子（120°整形後）を持っておく。重ね合わせの座標・立体は
        // **実際に画面に描かれている図**から読む（整形は幾何を変えないことを保証済み）。
        // ⚠ 整形後の target も残す —— 重ね合わせで図Bを回すときの素になる（overlayPlan）
        this._dispTargetA = reshapeGeometryForDisplay(this.game, q.targetA);
        this._dispTargetB = reshapeGeometryForDisplay(this.game, q.targetB);
        this._dispMolA = renderMoleculeIntoSvg(this.game, 'sq-svg-a', this._dispTargetA, wedge);
        this._dispMolB = renderMoleculeIntoSvg(this.game, 'sq-svg-b', this._dispTargetB, wedge);
        this.current = q;
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        // 前の問題の塗り分けを消す（消さないと装飾色が戻らない）
        clearQuizChoiceMarks(Object.keys(this.buttons).map(k => this.buttons[k]));
        this.updateScore();
    }

    answer(said) {
        if (!this.current || this.buttons.same.disabled) return;
        const c = this.current;
        // 選んだものと正解の両方を残す（2026-08-09）。**この画面はとくに要る**——
        // 3つのボタンは装飾色（青・オレンジ）を持っていて、答えたあとも
        // 押していないボタンが目立ったままだった
        const order = ['same', 'enantiomer', 'diastereomer'];
        markQuizChoices(order.map(k => this.buttons[k]),
            b => b === this.buttons[c.rel],
            this.buttons[said] || null);
        this.score.asked++;
        const correct = said === c.rel;
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'stereo', correct: correct });
        const label = { same: '同じ分子', enantiomer: '鏡像異性体', diastereomer: '別の立体異性体（ジアステレオマー）' };
        const head = correct ? '⭕ 正解！' : `❌ 残念…正解は「${label[c.rel]}」。`;
        this.resultEl.textContent = head + ' ' + this.explain(c);
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        // 答え合わせのあとで「重ねて確かめる」を出す（M2.5-A。答えが透けるので解答前は出さない）
        if (this.overlayBtn && this.overlayCompare()) this.overlayBtn.classList.remove('hidden');
        this.updateScore();
    }

    // ===== 重ね合わせビュー（M2.5-A ＋ 回転 2026-08-25） =====
    //
    // 「重ね合わせられるか」という立体異性の定義そのものを操作で見せる。
    // 図Bをシャドウ化し、**許された角度のうちいちばん重なるものへ回してから**図Aへ重ね、
    // 不斉炭素・C=C ごとに一致(✓)/食い違い(✗)の印を付ける。
    // 原子の対応は座標ではなく**正準ラベリング（グラフの同型写像）**で決め、
    // 全対応のうち一致数が最大のものを使う（chemistry.js の stereoIsomorphismCompare）。
    // だから「最もよく重なる対応でも食い違いが残る＝重ね合わせられない」と正確に言える。
    //
    // ⚠⚠ **なぜ回転を入れたか**（2026-08-25 の実測）。回さずに平行移動だけで重ねていたので、
    // 標準モードの出題の **49%（196/400）が 180°回転の問題**なのに、そのすべてで
    // 図が交差したまま（**ずれ RMS 151px ＝ 3マス超**）「すべて重なる＝同じ分子です」と
    // 書いていた。**言葉と絵が正反対**だった。重ね合わせは「回転と平行移動で一致するか」なので、
    // 回転を試さない絵はそもそも重ね合わせの絵になっていない。
    //
    // ★ **許された角度の決め方**（新しい規則は書かない）。図Bを 90°刻みで回して
    // **立体を読み直し**、`canonicalCode` と `canonicalStereoCode` が変わらない角度だけを使う
    // ＝ `applyVerifiedFischerOp` と同じ「生成側を信用しない」作法をそのまま借りる。
    // フィッシャー投影は 90° 回すと読みの約束（縦＝奥）が崩れて鏡像に化けるし、
    // ハース投影は面内の回転そのものが鏡像の図になる（DESIGN_sugar.md §1-2）——
    // どちらもここで**自動的に**弾かれる。実測の内訳（標準モード400問）は §「否定対照」の表。
    //
    // ⚠ **回転は見せ方だけ。** 正否の判定（`stereoIsomorphismCompare` の一致/不一致）には
    // 触っていない。回してよい角度は立体コードを変えない角度に限られているので、
    // どの角度を選んでも比較の結果（centers / geos の match）は同じになる。
    // ⚠ **鏡映はどの角度でも使わない** —— 鏡に映して重なるのがエナンチオマーの定義なので、
    // 鏡映を許すと「重ね合わせられるか」という問いそのものが消える。

    /** 図Bに当ててよい紙面内回転（90°刻み）の一覧。0 は必ず入る */
    overlayAllowedTurns() {
        const t = this._dispTargetB;
        if (!t || typeof applyVerifiedFischerOp !== 'function') return [0];
        const list = [];
        for (let k = 0; k < 4; k++) {
            // ⚠ 立体を読み直して確かめる（回した図から読む）。k=0 も同じ関門を通す
            const cand = applyVerifiedFischerOp(this.game, t, () => rotateTargetInPlane(t, k, false));
            if (cand) list.push(k);
        }
        return list.length ? list : [0];
    }

    /**
     * 「どう回して、どれだけ重なったか」。問題ごとにキャッシュする。
     * 返り値 { turns, allowed, molB, cmp, dx, dy, rms, mismatch } ／ できなければ null。
     * `rms` は最良の対応での**残りのずれ**（px）。0 なら図がぴったり重なった。
     */
    overlayPlan() {
        if (this._overlayPlan !== undefined) return this._overlayPlan;
        this._overlayPlan = null;
        if (!this._dispMolA || !this._dispMolB || typeof stereoIsomorphismCompare !== 'function') {
            return this._overlayPlan;
        }
        const molA = this._dispMolA;
        const a = readStereoOf(molA);
        if (!a) return this._overlayPlan;
        const allowed = this.overlayAllowedTurns();
        // 1つの候補（回した図B）を測る: 対応づけ → 重心合わせ → 残りのずれ
        const measure = (molB) => {
            const b = readStereoOf(molB);
            if (!b) return null;
            const cmp = stereoIsomorphismCompare(molA, a.stereo, molB, b.stereo);
            if (!cmp) return null;
            const pairs = [];
            Object.keys(cmp.map).forEach(idA => {
                const pa = molA.atoms.find(x => x.id === idA);
                const pb = molB.atoms.find(x => x.id === cmp.map[idA]);
                if (pa && pb) pairs.push([pa, pb]);
            });
            if (!pairs.length) return null;
            const dx = pairs.reduce((s, p) => s + (p[0].x - p[1].x), 0) / pairs.length;
            const dy = pairs.reduce((s, p) => s + (p[0].y - p[1].y), 0) / pairs.length;
            const ss = pairs.reduce((s, p) => {
                const ex = p[0].x - (p[1].x + dx), ey = p[0].y - (p[1].y + dy);
                return s + ex * ex + ey * ey;
            }, 0);
            return { molB, cmp, dx: Math.round(dx), dy: Math.round(dy),
                     rms: Math.sqrt(ss / pairs.length),
                     mismatch: cmp.centers.filter(x => !x.match).length +
                               cmp.geos.filter(x => !x.match).length };
        };
        let best = null;
        allowed.forEach(k => {
            const molB = (k === 0)
                ? this._dispMolB
                : this.game.createTargetFromData({ target: rotateTargetInPlane(this._dispTargetB, k, false) });
            const m = measure(molB);
            if (!m) return;
            // 同じだけ重なるなら**回さない**（見せ方は控えめな方を選ぶ）。
            // allowed は 0 から昇順なので、0.5px を超えて良くなったときだけ乗り換える
            if (!best || m.rms < best.rms - 0.5) best = Object.assign({ turns: k }, m);
        });
        if (best) this._overlayPlan = Object.assign({ allowed }, best);
        return this._overlayPlan;
    }

    /** 表示中の2つの図の立体比較（実際に描く対応と同じもの）。できなければ null */
    overlayCompare() {
        const plan = this.overlayPlan();
        return plan ? plan.cmp : null;
    }

    toggleOverlay() {
        if (this._overlayOn) this.clearOverlay();
        else this.showOverlay();
    }

    showOverlay() {
        const plan = this.overlayPlan();
        const svgA = document.getElementById('sq-svg-a');
        const svgB = document.getElementById('sq-svg-b');
        if (!plan || !svgA || !svgB) {
            if (this.overlayNoteEl) this.overlayNoteEl.textContent = 'この組では重ね合わせ表示ができません。';
            return;
        }
        const cmp = plan.cmp;
        // ★ molB は**選ばれた角度へ回したあとの図**（回さない方が良ければ turns=0 の図そのもの）
        const molA = this._dispMolA, molB = plan.molB;
        const heavyB = molB.atoms.filter(a => a.element !== 'H');
        // 平行移動量: 対応づけた原子どうしの重心を合わせる（回したあとに合わせる）
        const dx = plan.dx, dy = plan.dy;

        const NS = 'http://www.w3.org/2000/svg';
        // 図Bのゴースト（重原子の骨格だけ。水素・くさびは省いて「影」であることを分かりやすく）
        const ghost = document.createElementNS(NS, 'g');
        ghost.setAttribute('class', 'sq-overlay-ghost');
        ghost.setAttribute('style',
            'opacity:0; transform:translate(120px,0); transition:opacity .5s ease, transform .5s ease;' +
            ' filter:drop-shadow(0 0 5px rgba(0,242,254,0.7));');
        molB.bonds.forEach(b => {
            const a1 = molB.atoms.find(a => a.id === b.atomId1);
            const a2 = molB.atoms.find(a => a.id === b.atomId2);
            if (!a1 || !a2) return;
            this.game.renderTargetBond(a1.x + dx, a1.y + dy, a2.x + dx, a2.y + dy, b.type, false, ghost);
        });
        heavyB.forEach(a => this.game.renderTargetAtom(a.element, a.x + dx, a.y + dy, ghost));
        svgA.appendChild(ghost);

        // 一致/不一致の印（図Aの座標に描く。ゴーストが滑り込んだあとに現れる）
        const marks = document.createElementNS(NS, 'g');
        marks.setAttribute('class', 'sq-overlay-marks');
        marks.setAttribute('style', 'opacity:0; transition:opacity .4s ease .45s;');
        const addMark = (x, y, match) => {
            const color = match ? 'rgba(46,213,115,0.95)' : 'rgba(255,71,87,0.95)';
            const ring = document.createElementNS(NS, 'circle');
            ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', 17);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', color);
            ring.setAttribute('stroke-width', '2.5');
            if (!match) ring.setAttribute('stroke-dasharray', '5 3');
            marks.appendChild(ring);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x + 14); t.setAttribute('y', y - 14);
            t.setAttribute('fill', color);
            t.setAttribute('font-size', '15');
            t.setAttribute('font-weight', 'bold');
            t.textContent = match ? '✓' : '✗';
            marks.appendChild(t);
        };
        const atomOf = id => molA.atoms.find(a => a.id === id);
        cmp.centers.forEach(cn => { const a = atomOf(cn.a); if (a) addMark(a.x, a.y, cn.match); });
        cmp.geos.forEach(gs => {
            const a1 = atomOf(gs.a[0]), a2 = atomOf(gs.a[1]);
            if (a1 && a2) addMark((a1.x + a2.x) / 2, (a1.y + a2.y) / 2, gs.match);
        });
        svgA.appendChild(marks);

        // 図Aの枠を、ゴーストも収まる範囲へ広げる（元の viewBox は解除時に戻す）
        this._overlayViewBox = svgA.getAttribute('viewBox');
        const vb = (this._overlayViewBox || '0 0 320 250').split(/\s+/).map(Number);
        let minX = vb[0], minY = vb[1], maxX = vb[0] + vb[2], maxY = vb[1] + vb[3];
        heavyB.forEach(a => {
            minX = Math.min(minX, a.x + dx - 30); maxX = Math.max(maxX, a.x + dx + 30);
            minY = Math.min(minY, a.y + dy - 30); maxY = Math.max(maxY, a.y + dy + 30);
        });
        svgA.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

        // 滑り込みアニメーション開始（2段 rAF で初期スタイルを確定させてから遷移）
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ghost.style.opacity = '0.55';
            ghost.style.transform = 'translate(0,0)';
            marks.style.opacity = '1';
        }));
        svgB.style.opacity = '0.25';

        // 言葉でも結果を示す（数は最良の対応での実測値）
        const badC = cmp.centers.filter(x => !x.match).length;
        const badG = cmp.geos.filter(x => !x.match).length;
        const parts = [];
        if (cmp.centers.length) {
            parts.push(badC === 0
                ? `不斉炭素原子 ${cmp.centers.length} 個はすべて一致（緑の◯）`
                : `不斉炭素原子 ${cmp.centers.length} 個中 ${badC} 個で立体が食い違い（赤の破線◯）`);
        }
        if (cmp.geos.length) {
            parts.push(badG === 0
                ? 'C=C のシス/トランスは一致（緑の◯）'
                : `C=C ${cmp.geos.length} 本中 ${badG} 本でシス/トランスが食い違い（赤の破線◯）`);
        }
        // ★ **何をしたかを必ず書く**（回した／回さなかった・どの角度を試せたか）。
        // 直す前は「平行移動しました」としか書かず、しかも実際は回していなかったので、
        // 180°回転の問題では交差した絵の下に「すべて重なる」と出ていた
        const NAMES = ['0°（回さない）', '90°', '180°', '270°'];
        const did = plan.turns === 0
            ? '図Bを「回さずに」影にして図Aへ重ねました。'
            : `図Bを ${plan.turns * 90}° 回してから影にして図Aへ重ねました。`;
        const tried = plan.allowed.length >= 4
            ? '紙面内の 90°刻み（0°・90°・180°・270°）をすべて試し、いちばん重なるものを選んでいます。'
            : `試せる角度は ${plan.allowed.map(k => NAMES[k]).join('・')} だけです` +
              '（ほかの角度は、回すと図から読める立体そのものが変わってしまうので使えません）。' +
              'そのなかでいちばん重なるものを選びました。';
        const fit = plan.rms < 2;
        // ★ どう回しても重ならないときは言い切る（重ね合わせの定義を画面に出す）
        let verdict;
        if (badC + badG > 0) {
            verdict = '→ 紙面内でどう回しても重なりません。' +
                '回転と平行移動だけで一致するものが「重ね合わせられる＝同じ分子」なので、' +
                'これは重ね合わせられない別の分子です' +
                '（鏡に映せば重なる場合もありますが、それは鏡像異性体の関係です）。';
        } else if (fit) {
            verdict = '→ 図がぴったり重なりました（ずれ 0px）＝ 回転と平行移動だけで一致する＝同じ分子です。';
        } else {
            // 立体はすべて一致しているのに絵が合わない ＝ 紙面内の回転では届かない置き方
            // （左右を反転した図など）。ここで「すべて重なる」と書くと絵と食い違う
            verdict = '→ 立体はすべて一致＝同じ分子ですが、紙面内の回転では絵は重なりません' +
                `（残りのずれ ${Math.round(plan.rms)}px）。` +
                '紙から持ち上げて裏返すか、図を描き直せば重なります。';
        }
        if (this.overlayNoteEl) {
            this.overlayNoteEl.textContent =
                did + tried + '\n' +
                '原子の対応は、見た目の位置ではなく「つながり方が最もよく合う対応」で決めています' +
                '（鏡に映す操作は使いません——鏡映で重なるのが鏡像異性体の定義だからです）。\n' +
                parts.join('、') + ' ' + verdict;
        }
        if (this.overlayBtn) this.overlayBtn.textContent = '↩ 重ね合わせを解除';
        this._overlayOn = true;
    }

    clearOverlay() {
        this._overlayOn = false;
        const svgA = document.getElementById('sq-svg-a');
        const svgB = document.getElementById('sq-svg-b');
        if (svgA) svgA.querySelectorAll('.sq-overlay-ghost, .sq-overlay-marks').forEach(el => el.remove());
        if (svgA && this._overlayViewBox) svgA.setAttribute('viewBox', this._overlayViewBox);
        this._overlayViewBox = null;
        if (svgB) svgB.style.opacity = '';
        if (this.overlayNoteEl) this.overlayNoteEl.textContent = '';
        if (this.overlayBtn) this.overlayBtn.textContent = '🫟 回して重ねる（図Bを回して図Aに重ねてみる）';
    }

    /**
     * ジアステレオマーの理由を、その分子に即して言い分ける（P12-8。ユーザー指摘）。
     * 「不斉炭素の違い」と「C=C のシス/トランス」は高校では別の名前で扱う話題なので、
     * 両論併記にせず、実際にどちらなのかを見て言い切る。
     */
    diastereomerWhy(c) {
        const a = readStereoOf(c.molA);
        const head = '立体異性体ですが鏡像ではありません（ジアステレオマー）。';
        if (!a) return head;
        if (a.centers === 0 && a.geoms > 0) {
            return 'C=C のまわりの並びが違う「シス・トランス異性体（幾何異性体）」です。' +
                '二重結合は回転できないので、同じ側（シス）に付いているか反対側（トランス）に' +
                '付いているかで別の分子になります。鏡像の関係ではないので、' +
                'ジアステレオマーに分類されます。';
        }
        if (a.centers > 0 && a.geoms === 0) {
            return head + `不斉炭素原子が ${a.centers} 個あり、そのうち一部だけが逆になっています` +
                '（すべて逆なら鏡像異性体になります）。';
        }
        return head + '不斉炭素原子の立体か、C=C のシス/トランスのどちらかが部分的に違います。';
    }

    explain(c) {
        const why = {
            same: '重ね合わせられる（回転だけで一致する）ので同じ分子です。',
            enantiomer: '鏡に映すと重なるが、回転だけでは重ならない関係です（エナンチオマー）。' +
                'すべての不斉炭素原子で立体が逆になっています。',
            diastereomer: this.diastereomerWhy(c)
        }[c.rel];
        let how;
        if (c.how === 'pair') {
            how = `左は「${c.nameA}」、右は「${c.nameB}」。`;
        } else {
            const deg = c.turns * 90;
            how = `どちらも「${c.nameA}」を描いた図で、右は左を紙面内で ${deg}° 回した` +
                (c.mirror ? '（さらに左右を反転した）' : '') + 'ものです。';
            if (!c.mirror && c.turns % 2 === 1 && c.rel === 'enantiomer') {
                how += '\n※ フィッシャー投影は「紙面内で90°回すと鏡像になる」性質があります' +
                    '（縦が紙面の奥・横が手前という約束なので、90°回すと奥と手前が入れ替わる）。' +
                    '180°なら同じ分子のままです。';
            }
            if (c.mirror && c.rel === 'same') {
                // 「鏡映したのに同じ」の理由は2通りある。取り違えると嘘になる
                how += c.achiral
                    ? '\n※ この分子は鏡像が自分自身と一致します（不斉炭素原子が無い、またはメソ体で分子内に対称面がある）。' +
                      'つまり鏡像異性体が存在しません。'
                    : '\n※ この分子には鏡像異性体があります。にもかかわらず同じ分子になったのは、' +
                      '左右の反転と紙面内の回転が打ち消し合ったからです' +
                      '（フィッシャー投影では90°回転が鏡像に相当するので、反転と組み合わさると元に戻ることがあります）。';
            }
        }
        return how + '\n' + why;
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// ===== フィッシャー投影の操作学習（M2.5-B） =====
//
// 2つの図を並べ、右の図だけを「分子を変えない図上の変形」で操作して見比べる練習モード。
// 許す操作は**偶置換**になるものだけ（DEVELOPMENT.md M2.5-B。2026-07-27 ユーザー指定）:
//   ・180°回転（上下と左右の同時入れ替え＝転置2回＝偶）
//   ・90°回転＋（回転後の）左右入れ替え（4巡回＋転置＝偶）。90°単独は奇置換＝鏡像に
//     なってしまうので、そういうボタンは**UIに出さない**
//   ・1つのC原子で軸の枝を固定し、残り3つの枝を巡回（3巡回＝偶）
// どの操作も、適用した図から立体を**読み直して** canonicalCode / canonicalStereoCode が
// 変わっていないことを確かめてから確定する（生成側の意図を信用しない、の方針どおり）。
// 変わってしまう場合（枝の中に別の不斉炭素がある巡回など）は適用しない。

/**
 * 変形候補を作って検証し、分子が変わっていなければ新しい target を返す共通部。
 * 棄却条件: 立体が読めなくなる／正準コードか立体コードが変わる／原子が重なる。
 */
function applyVerifiedFischerOp(game, target, makeCandidate) {
    const before = readStereoOf(game.createTargetFromData({ target }));
    if (!before) return null;
    const cand = makeCandidate();
    if (!cand) return null;
    // 原子どうしが重なる図は読み間違いのもとなので不可（グリッド42pxの半分を下限とする）
    for (let i = 0; i < cand.atoms.length; i++) {
        for (let j = i + 1; j < cand.atoms.length; j++) {
            if (Math.hypot(cand.atoms[i].x - cand.atoms[j].x,
                           cand.atoms[i].y - cand.atoms[j].y) < 21) return null;
        }
    }
    const after = readStereoOf(game.createTargetFromData({ target: cand }));
    if (!after) return null;
    if (after.code !== before.code || after.stereoCode !== before.stereoCode) return null;
    if (after.centers !== before.centers || after.geoms !== before.geoms) return null;
    return cand;
}

// 180°回転（偶置換なので分子は変わらない）
function fischerOpRotate180(game, target) {
    return applyVerifiedFischerOp(game, target, () => rotateTargetInPlane(target, 2, false));
}

/**
 * 90°回転＋（回転後の）左右入れ替え。90°単独は4巡回＝奇置換で鏡像になってしまうので、
 * 転置を1つ重ねて偶に戻す。「90°回すと縦横＝奥/手前の意味が入れ替わるから、同じ分子を
 * 保つには2つを入れ替える必要がある」というフィッシャーの規約そのものを操作で見せる。
 * 実装は rotateTargetInPlane の mirrorX（回転後に x を反転＝左右の枝の入れ替え）。
 */
function fischerOpRotate90(game, target, dir) {
    const turns = dir === 'ccw' ? 3 : 1;
    return applyVerifiedFischerOp(game, target, () => rotateTargetInPlane(target, turns, true));
}

/**
 * 1つの不斉炭素で「軸にする枝」(fixedSlot) を固定し、残り3つの枝を巡回させる
 * （3巡回＝偶置換。くさび図の cycleOthers を2Dの作図データの上で行う版）。
 * centerIndex は target.atoms のインデックス。dir='cw' は残り3スロットを時計回りに送る。
 * 枝（サブツリー）は中心を軸に±90°/180°の剛体回転で動かす。暗黙のHのスロットは
 * 動かすものが無いのでそのまま。環・枝の共有・他の中心が壊れる場合は null。
 */
function fischerOpCycle(game, target, centerIndex, fixedSlot, dir) {
    const AXES = [
        { key: 'up', vx: 0, vy: -1 }, { key: 'right', vx: 1, vy: 0 },
        { key: 'down', vx: 0, vy: 1 }, { key: 'left', vx: -1, vy: 0 }
    ];
    if (!AXES.some(ax => ax.key === fixedSlot)) return null;
    return applyVerifiedFischerOp(game, target, () => {
        const center = target.atoms[centerIndex];
        if (!center) return null;
        const adj = target.atoms.map(() => []);
        target.bonds.forEach(b => {
            adj[b.atom1Index].push(b.atom2Index);
            adj[b.atom2Index].push(b.atom1Index);
        });
        // 隣接をスロット（±25°。判定と同じ許容）へ分類
        const COS_TOL = Math.cos(25 * Math.PI / 180);
        const slotOf = {};
        for (const ni of adj[centerIndex]) {
            const a = target.atoms[ni];
            const dx = a.x - center.x, dy = a.y - center.y;
            const len = Math.hypot(dx, dy) || 1;
            const hit = AXES.find(ax => (dx * ax.vx + dy * ax.vy) / len >= COS_TOL);
            if (!hit || slotOf[hit.key] !== undefined) return null; // 軸外れ・スロット衝突
            slotOf[hit.key] = ni;
        }
        // 巡回する3スロット（up→right→down→left の時計回りの並びから軸を除く）
        const ring = ['up', 'right', 'down', 'left'].filter(k => k !== fixedSlot);
        const step = dir === 'ccw' ? 2 : 1;
        // スロット from の枝を to へ動かす剛体回転（軸ベクトルどうしなので cos/sin は 0/±1）
        const rotTo = (from, to, p) => {
            const A = AXES.find(ax => ax.key === from);
            const B = AXES.find(ax => ax.key === to);
            const cos = A.vx * B.vx + A.vy * B.vy;
            const sin = A.vx * B.vy - A.vy * B.vx;
            const dx = p.x - center.x, dy = p.y - center.y;
            return { x: Math.round(center.x + dx * cos - dy * sin),
                     y: Math.round(center.y + dx * sin + dy * cos) };
        };
        const atoms = target.atoms.map(a => Object.assign({}, a));
        const used = new Set();
        for (let i = 0; i < 3; i++) {
            const from = ring[i], to = ring[(i + step) % 3];
            const rootIdx = slotOf[from];
            if (rootIdx === undefined) continue; // 暗黙のHのスロット: 動かすものが無い
            // 枝のサブツリー（中心を通らずに届く原子）を集めて回す
            const seen = new Set([centerIndex, rootIdx]);
            const stack = [rootIdx], branch = [rootIdx];
            while (stack.length) {
                adj[stack.pop()].forEach(n => {
                    if (!seen.has(n)) { seen.add(n); branch.push(n); stack.push(n); }
                });
            }
            for (const idx of branch) {
                if (used.has(idx)) return null; // 枝が共有されている＝環を含む
                used.add(idx);
                const p = rotTo(from, to, target.atoms[idx]);
                atoms[idx].x = p.x;
                atoms[idx].y = p.y;
            }
        }
        return { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
    });
}

/**
 * 1つの不斉炭素で、向かい合う2スロットを入れ替える（転置1回＝**奇置換**）。
 * その中心の立体が反転する ＝**分子が変わる操作**。
 *
 *   axis='vertical'   … **縦軸の鏡**。左右が入れ替わる（十字の模型では左辺・右辺の鏡）
 *   axis='horizontal' … **横軸の鏡**。上下が入れ替わる（同じく上辺・下辺の鏡）
 *
 * 鏡は自分自身が逆操作（2回で戻る）。**辺は4つあるが結果は2通りしかない**
 * ＝ 鏡像は1つしかない、というのがこの見せ方の芯（C-5c）。
 * 練習モード（M2.5-B。分子を変えない操作だけ）には出さず、
 * タイムアタック（M2.5-C。お題の立体異性体を「作る」のが目的）でだけ使う。
 * つながり方（canonicalCode）と中心の数は変わらないことを検証してから確定する。
 */
function fischerOpMirror(game, target, centerIndex, axis) {
    const AXES = [
        { key: 'up', vx: 0, vy: -1 }, { key: 'right', vx: 1, vy: 0 },
        { key: 'down', vx: 0, vy: 1 }, { key: 'left', vx: -1, vy: 0 }
    ];
    const before = readStereoOf(game.createTargetFromData({ target }));
    if (!before) return null;
    const trySwap = (keyA, keyB) => {
        const center = target.atoms[centerIndex];
        if (!center) return null;
        const adj = target.atoms.map(() => []);
        target.bonds.forEach(b => {
            adj[b.atom1Index].push(b.atom2Index);
            adj[b.atom2Index].push(b.atom1Index);
        });
        const COS_TOL = Math.cos(25 * Math.PI / 180);
        const slotOf = {};
        for (const ni of adj[centerIndex]) {
            const a = target.atoms[ni];
            const dx = a.x - center.x, dy = a.y - center.y;
            const len = Math.hypot(dx, dy) || 1;
            const hit = AXES.find(ax => (dx * ax.vx + dy * ax.vy) / len >= COS_TOL);
            if (!hit || slotOf[hit.key] !== undefined) return null;
            slotOf[hit.key] = ni;
        }
        // 入れ替え＝それぞれの枝サブツリーを中心まわりに180°回転（暗黙Hの側は動かすものが無い）
        const atoms = target.atoms.map(a => Object.assign({}, a));
        const used = new Set();
        for (const key of [keyA, keyB]) {
            const rootIdx = slotOf[key];
            if (rootIdx === undefined) continue;
            const seen = new Set([centerIndex, rootIdx]);
            const stack = [rootIdx], branch = [rootIdx];
            while (stack.length) {
                adj[stack.pop()].forEach(n => {
                    if (!seen.has(n)) { seen.add(n); branch.push(n); stack.push(n); }
                });
            }
            for (const idx of branch) {
                if (used.has(idx)) return null; // 枝の共有＝環を含む
                used.add(idx);
                atoms[idx].x = Math.round(2 * center.x - target.atoms[idx].x);
                atoms[idx].y = Math.round(2 * center.y - target.atoms[idx].y);
            }
        }
        const cand = { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
        for (let i = 0; i < cand.atoms.length; i++) {
            for (let j = i + 1; j < cand.atoms.length; j++) {
                if (Math.hypot(cand.atoms[i].x - cand.atoms[j].x,
                               cand.atoms[i].y - cand.atoms[j].y) < 21) return null;
            }
        }
        const after = readStereoOf(game.createTargetFromData({ target: cand }));
        if (!after) return null;
        // つながり方は不変。立体コードは変わってよい（それがこの操作の目的）
        if (after.code !== before.code) return null;
        if (after.centers !== before.centers || after.geoms !== before.geoms) return null;
        return cand;
    };
    return axis === 'horizontal' ? trySwap('up', 'down') : trySwap('left', 'right');
}

/**
 * 中心の立体を反転させる（軸は問わない）。まず縦軸の鏡を試し、枝が重なるなどで無理なら
 * 横軸の鏡を試す。どちらも転置1回なので、その中心の反転として同じ意味になる。
 * 練習モードと、軸を指定しない呼び出し（既存の互換）のために残す。
 */
function fischerOpSwap(game, target, centerIndex) {
    return fischerOpMirror(game, target, centerIndex, 'vertical') ||
           fischerOpMirror(game, target, centerIndex, 'horizontal');
}

class FischerPractice {
    /**
     * opts.prefix で要素IDの接頭辞を切り替えられる（タイムアタック M2.5-C が 'ta' で継承する）。
     * 参照する要素: `${p}-task/-status/-centers/-axis/-moves/-svg-a/-svg-b` と `btn-${p}-…`
     */
    constructor(game, opts) {
        const o = Object.assign(
            { prefix: 'fp', modalId: 'fischer-practice-modal', openBtnId: 'btn-fischer-practice' }, opts);
        this.game = game;
        this.p = o.prefix;
        this.pool = null;
        this.current = null; // { entry, targetA, targetB, base, how }
        this.moves = 0;
        this.finished = false; // タイムアタックで完成後の操作を止めるため（練習では常に false）
        this.selCenter = null; // 選択中の中心（target.atoms のインデックス）
        this.selAxis = 'up';
        this.modal = document.getElementById(o.modalId);
        if (!this.modal) return;
        const p = this.p;
        this.taskEl = document.getElementById(`${p}-task`);
        this.statusEl = document.getElementById(`${p}-status`);
        this.centersEl = document.getElementById(`${p}-centers`);
        this.axisEl = document.getElementById(`${p}-axis`);
        this.movesEl = document.getElementById(`${p}-moves`);
        const btn = document.getElementById(o.openBtnId);
        if (btn) btn.addEventListener('click', () => this.open());
        // 置いていないボタンは黙って飛ばす。タイムアタック（'ta'）は操作を
        // 「回転CW・回転ACW・鏡像の入れ替え」の3つに絞ってあり、180°回転と巡回を持たない
        // （2026-08-01 ユーザー指定。練習モード 'fp' は全部そろえたまま）
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on(`btn-${p}-close`, () => this.modal.classList.add('hidden'));
        on(`btn-${p}-next`, () => this.newQuestion());
        on(`btn-${p}-reset`, () => this.resetFigure());
        on(`btn-${p}-rot180`, () => this.applyOp('rot180'));
        on(`btn-${p}-rot90cw`, () => this.applyOp('rot90cw'));
        on(`btn-${p}-rot90ccw`, () => this.applyOp('rot90ccw'));
        on(`btn-${p}-cycle-cw`, () => this.applyCycle('cw'));
        on(`btn-${p}-cycle-ccw`, () => this.applyCycle('ccw'));
    }

    open() {
        this.build();
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    build() {
        if (this.pool) return;
        // フィッシャー投影として立体が読める鎖状分子だけ。環（ハース）は投影の規約が別で、
        // C=C の幾何も別の話題なので混ぜない
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info && !info.fromRing && info.geoms === 0 && info.centers >= 1) {
                this.pool.push(Object.assign({}, e, info));
            }
        });
    }

    // 図の「見た目」の同一性（平行移動だけ無視）。ぴったり戻せたかの判定に使う
    static drawingKey(target) {
        const cx = target.atoms.reduce((s, a) => s + a.x, 0) / target.atoms.length;
        const cy = target.atoms.reduce((s, a) => s + a.y, 0) / target.atoms.length;
        const pt = a => `${Math.round(a.x - cx)},${Math.round(a.y - cy)}`;
        const atoms = target.atoms.map(a => `${a.element}:${pt(a)}`).sort();
        const bonds = target.bonds
            .map(b => [pt(target.atoms[b.atom1Index]), pt(target.atoms[b.atom2Index])].sort().join('~') + ':' + b.type)
            .sort();
        return atoms.join('|') + '#' + bonds.join('|');
    }

    // フィッシャーとして読める不斉炭素の target インデックス（mol.atoms[i] ⇔ target.atoms[i]）
    readableCenters(target) {
        const mol = this.game.createTargetFromData({ target });
        return Object.keys(readAtomParityFromFischer(mol))
            .map(id => mol.atoms.findIndex(a => a.id === id))
            .filter(i => i >= 0)
            .sort((a, b) => a - b);
    }

    // いま右に描かれている分子の、左との関係（毎回、図から読み直して判定する）
    currentRelation() {
        if (!this.current) return null;
        return StereoQuiz.relationOf(
            this.game.createTargetFromData({ target: this.current.targetA }),
            this.game.createTargetFromData({ target: this.current.targetB }));
    }

    // お題のかき混ぜ: 許された操作だけを重ねる（＝必ず同じ分子のまま）
    scramble(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const ops = [
                () => fischerOpRotate180(this.game, t),
                () => fischerOpRotate90(this.game, t, 'cw'),
                () => fischerOpRotate90(this.game, t, 'ccw')
            ];
            const centers = this.readableCenters(t);
            if (centers.length) {
                const ci = centers[Math.floor(Math.random() * centers.length)];
                const slot = ['up', 'right', 'down', 'left'][Math.floor(Math.random() * 4)];
                ops.push(() => fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw'));
            }
            const r = ops[Math.floor(Math.random() * ops.length)]();
            if (r) t = r;
        }
        return t;
    }

    newQuestion() {
        this.build();
        if (!this.pool.length) {
            if (this.statusEl) this.statusEl.textContent = '出題できる分子が見つかりませんでした。';
            return;
        }
        let q = null;
        for (let tries = 0; tries < 40 && !q; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            // 鏡像のお題はキラルな分子だけ（アキラルだと鏡像＝同じ分子で、ねらいがぼける）
            const mirror = e.stereoCode !== e.mirrorCode && Math.random() < 0.4;
            let tB = mirror
                ? rotateTargetInPlane(e.target, 0, true)
                : this.scramble(e.target, 1 + Math.floor(Math.random() * 3));
            if (!mirror && FischerPractice.drawingKey(tB) === FischerPractice.drawingKey(e.target)) continue;
            // 図から読み直した関係が想定どおりであることを確認してから出題する
            const rel = StereoQuiz.relationOf(
                this.game.createTargetFromData({ target: e.target }),
                this.game.createTargetFromData({ target: tB }));
            if (mirror ? rel !== 'enantiomer' : rel !== 'same') continue;
            q = { entry: e, targetA: e.target, targetB: tB, base: tB, how: mirror ? 'mirror' : 'scramble' };
        }
        if (!q) {
            if (this.statusEl) this.statusEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.moves = 0;
        this.finished = false;
        this.selCenter = null;
        this.selAxis = 'up';
        if (this.taskEl) {
            this.taskEl.textContent = q.how === 'mirror'
                ? `左は「${q.entry.name}」、右はそれを鏡に映した図です。分子を変えない操作だけで、右を左と同じ図にできるでしょうか？`
                : `左は「${q.entry.name}」、右は同じ分子を（分子を変えない操作で）かき混ぜた図です。操作で左とぴったり同じ図に戻してみましょう。`;
        }
        renderMoleculeIntoSvg(this.game, `${this.p}-svg-a`, q.targetA, false);
        this.refresh(true);
    }

    resetFigure() {
        if (!this.current) return;
        this.current.targetB = this.current.base;
        this.moves = 0;
        this.refresh(true);
    }

    applyOp(kind) {
        if (!this.current || this.finished) return;
        const t = this.current.targetB;
        const r = kind === 'rot180' ? fischerOpRotate180(this.game, t)
            : kind === 'rot90cw' ? fischerOpRotate90(this.game, t, 'cw')
            : fischerOpRotate90(this.game, t, 'ccw');
        if (!r) {
            if (this.statusEl) this.statusEl.textContent = 'この操作はこの図では行えません。';
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    applyCycle(dir) {
        if (!this.current || this.finished) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に回す中心（C）を選んでください。';
            return;
        }
        const r = fischerOpCycle(this.game, this.current.targetB, this.selCenter, this.selAxis, dir);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    'この回し方はこの図では行えません（枝どうしが重なるか、枝の中の別の不斉炭素原子の読みが壊れるため）。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /** 右の図・中心バッジ・軸ボタン・状態表示をまとめて更新する */
    refresh(resetStatus) {
        if (!this.current) return;
        const molB = renderMoleculeIntoSvg(this.game, `${this.p}-svg-b`, this.current.targetB, false);
        this.molB = molB; // 十字の模型（タイムアタック）が置換基のラベルを引くのに使う
        const centers = this.readableCenters(this.current.targetB);
        if (centers.length && (this.selCenter === null || !centers.includes(this.selCenter))) {
            this.selCenter = centers[0];
        }
        this.renderBadges(centers);
        this.renderCenterButtons(centers);
        this.renderAxisButtons(molB);
        this.updateStatus(resetStatus);
    }

    // 右の図の不斉炭素に①②…のバッジを重ねる（クリックで中心を選べる）
    renderBadges(centers) {
        const svg = document.getElementById(`${this.p}-svg-b`);
        if (!svg) return;
        const group = svg.querySelector('.fp-badges');
        if (!group) return;
        group.innerHTML = '';
        const NS = 'http://www.w3.org/2000/svg';
        centers.forEach((ci, k) => {
            const a = this.current.targetB.atoms[ci];
            const sel = ci === this.selCenter;
            const ring = document.createElementNS(NS, 'circle');
            ring.setAttribute('cx', a.x); ring.setAttribute('cy', a.y); ring.setAttribute('r', 15);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', sel ? 'rgba(224,176,255,0.95)' : 'rgba(224,176,255,0.35)');
            ring.setAttribute('stroke-width', sel ? '2.5' : '1.5');
            ring.setAttribute('style', 'cursor:pointer;');
            ring.addEventListener('click', () => { this.selCenter = ci; this.refresh(false); });
            group.appendChild(ring);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', a.x + 13); t.setAttribute('y', a.y - 13);
            t.setAttribute('fill', 'rgba(224,176,255,0.9)');
            t.setAttribute('font-size', '13');
            t.textContent = '①②③④⑤⑥⑦⑧⑨'[k] || String(k + 1);
            group.appendChild(t);
        });
    }

    renderCenterButtons(centers) {
        if (!this.centersEl) return;
        this.centersEl.innerHTML = '';
        if (centers.length <= 1) return; // 1つなら自動選択で足りる
        const label = document.createElement('span');
        label.style.color = 'var(--text-secondary)';
        label.textContent = '回す中心:';
        this.centersEl.appendChild(label);
        centers.forEach((ci, k) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.padding = '4px 10px';
            b.textContent = '①②③④⑤⑥⑦⑧⑨'[k] || String(k + 1);
            if (ci === this.selCenter) b.style.borderColor = 'var(--neon-purple)';
            b.addEventListener('click', () => { this.selCenter = ci; this.refresh(false); });
            this.centersEl.appendChild(b);
        });
    }

    // 軸（固定する枝）の選択ボタン。中身のラベル付きで、回せない軸は無効化して見せる
    renderAxisButtons(molB) {
        if (!this.axisEl) return;
        this.axisEl.innerHTML = '';
        if (this.selCenter === null || !molB) return;
        const centerAtom = molB.atoms[this.selCenter];
        const slots = centerAtom ? fischerSlots(molB, centerAtom.id) : null;
        if (!slots) return;
        const label = document.createElement('span');
        label.style.color = 'var(--text-secondary)';
        label.textContent = '軸にする枝（固定）:';
        this.axisEl.appendChild(label);
        const JA = { up: '上', right: '右', down: '下', left: '左' };
        ['up', 'right', 'down', 'left'].forEach(k => {
            const ref = slots[k];
            const name = ref === 'H' ? 'H' : substituentLabel(molB, ref, centerAtom.id);
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.padding = '4px 10px';
            b.textContent = `${JA[k]}（${name}）`;
            // どちら向きにも回せない軸は無効化（押しても分子が変わる操作は出さない、の方針）
            const ok = fischerOpCycle(this.game, this.current.targetB, this.selCenter, k, 'cw') ||
                       fischerOpCycle(this.game, this.current.targetB, this.selCenter, k, 'ccw');
            b.disabled = !ok;
            if (k === this.selAxis) b.style.borderColor = 'var(--neon-purple)';
            b.addEventListener('click', () => { this.selAxis = k; this.refresh(false); });
            this.axisEl.appendChild(b);
        });
    }

    updateStatus(resetStatus) {
        const rel = this.currentRelation();
        const matched = FischerPractice.drawingKey(this.current.targetA) ===
                        FischerPractice.drawingKey(this.current.targetB);
        const relText = {
            same: '左と同じ分子です（操作しても分子は変わっていません）',
            enantiomer: '左の鏡像異性体です。分子を変えない操作だけでは、左と同じ図には決してなりません',
            diastereomer: '左とは別の立体異性体です'
        }[rel] || '判定できません';
        let text = `いま右に描かれている分子: ${relText}。`;
        if (matched) {
            text = `🎯 ぴったり同じ図になりました！（手数 ${this.moves}）\n` +
                   '回転と巡回（分子を変えない操作）だけで一致した＝2つは同じ分子だと、図の上で確かめられました。';
        } else if (!resetStatus) {
            text += '\n図は変わりましたが、読み直しても分子は変わっていません（偶置換だけを許しているため）。';
        }
        if (this.statusEl) {
            this.statusEl.textContent = text;
            this.statusEl.className = matched ? 'result-message success' : '';
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
    }
}

// ===== 十字の模型（検品レビュー C-5c の操作面） =====
//
// 4つのスロット（上・右・下・左）を十字に置き、**各スロットの外側に回転ボタン**
// （押したスロットが「固定する枝」）、**外枠の4辺に鏡ボタン**を並べる共通部品。
// 立体タイムアタック（分子）と記号パズル（模式模型・ORDER 第2段）の**両方が
// 同じ操作面を使う**——「模式モードで規則を覚え、分子モードで実物に当てる」を
// 同じ手つきで通すため。ここが分かれると2つのモードが別の遊びになってしまう。
//
// DOM の前提: SVG `#${prefix}-cross`（中に `g.cross-labels`）と
//   `#btn-${prefix}-rot-<up|right|down|left>-<cw|ccw>`
//   `#btn-${prefix}-mirror-<top|bottom|left|right>`
// 中身は呼び出し側の関数が決める:
//   labels()  … { up, right, down, left, center } の表示（文字列か {text,color}）。
//               null なら空の十字
//   canCycle(slot, dir) / canMirror(axis) … 押せるか（押せない操作は出さない、の方針）
//   onCycle(slot, dir)  / onMirror(axis)  … 押されたときの処理
class CrossModel {
    constructor(prefix, handlers) {
        this.p = prefix;
        this.h = handlers;
        CrossModel.SLOTS.forEach(slot => ['ccw', 'cw'].forEach(dir => {
            const el = document.getElementById(`btn-${prefix}-rot-${slot}-${dir}`);
            if (el) el.addEventListener('click', () => this.h.onCycle(slot, dir));
        }));
        CrossModel.EDGES.forEach(e => {
            const el = document.getElementById(`btn-${prefix}-mirror-${e.edge}`);
            if (!el) return;
            el.addEventListener('click', () => {
                this.flash(e.axis); // 対になる辺が同じ操作だと分かるよう、両方を光らせる
                this.h.onMirror(e.axis);
            });
        });
    }

    /**
     * 十字の4スロット＋中心に文字を並べる（操作ボタンを持たない静止画にも使う）。
     * labels の各値は文字列か { text, color }。null なら「—」だけの空の十字。
     * 座標は viewBox "0 0 300 200" 前提（十字の線・中心の丸は SVG 側に直接書いてある）。
     */
    static paint(svg, labels) {
        const group = svg && svg.querySelector('.cross-labels');
        if (!group) return;
        group.innerHTML = '';
        const NS = 'http://www.w3.org/2000/svg';
        const put = (x, y, anchor, value, cls) => {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x); t.setAttribute('y', y);
            t.setAttribute('text-anchor', anchor);
            t.setAttribute('class', cls);
            if (value && value.color) t.setAttribute('fill', value.color);
            t.textContent = value && value.text !== undefined ? value.text : (value || '');
            group.appendChild(t);
        };
        if (!labels) { put(150, 106, 'middle', '—', 'cross-center'); return; }
        put(150, 30, 'middle', labels.up, 'cross-slot');
        put(244, 106, 'start', labels.right, 'cross-slot');
        put(150, 188, 'middle', labels.down, 'cross-slot');
        put(56, 106, 'end', labels.left, 'cross-slot');
        put(150, 106, 'middle', labels.center, 'cross-center');
    }

    /** 十字のラベルと、押せない操作の無効化をまとめて描き直す */
    render() {
        const labels = this.h.labels();
        CrossModel.paint(document.getElementById(`${this.p}-cross`), labels);
        CrossModel.SLOTS.forEach(slot => ['cw', 'ccw'].forEach(dir => {
            const b = document.getElementById(`btn-${this.p}-rot-${slot}-${dir}`);
            if (b) b.disabled = !labels || !this.h.canCycle(slot, dir);
        }));
        CrossModel.EDGES.forEach(e => {
            const b = document.getElementById(`btn-${this.p}-mirror-${e.edge}`);
            if (b) b.disabled = !labels || !this.h.canMirror(e.axis);
        });
    }

    /** 同じ結果になる2辺（左辺と右辺／上辺と下辺）を短く光らせる */
    flash(axis) {
        CrossModel.EDGES.filter(e => e.axis === axis).forEach(e => {
            const el = document.getElementById(`btn-${this.p}-mirror-${e.edge}`);
            if (!el) return;
            el.classList.add('cross-mirror-flash');
            setTimeout(() => el.classList.remove('cross-mirror-flash'), 420);
        });
    }
}

CrossModel.SLOTS = ['up', 'right', 'down', 'left'];
CrossModel.SLOT_JA = { up: '上', right: '右', down: '下', left: '左' };
// 外枠の4辺 → 鏡の向き。**辺は4つだが結果は2通り**（左辺と右辺・上辺と下辺は同じ操作）。
// 辺に鏡を立てると考えると、縦の辺は左右を、横の辺は上下を映すことになる
CrossModel.EDGES = [
    { edge: 'left', axis: 'vertical' }, { edge: 'right', axis: 'vertical' },
    { edge: 'top', axis: 'horizontal' }, { edge: 'bottom', axis: 'horizontal' }
];

// ===== 立体のタイムアタック（M2.5-C） =====
//
// お題の立体異性体と**同じ分子**を、操作で作るまでの時間・手数を競う
// （ルービックキューブ／マインスイーパー的。DEVELOPMENT.md M2.5-C）。
// 操作系は M2.5-B（FischerPractice）の土台を継承するが、**ボタンは作り直してある**。
//
// **操作は4種類だけ。すべて紙の上で許される手**（2026-08-01 ユーザー確定。検品レビュー C-5c）:
//
//   | 操作                                  | 置換       | 分子 | 逆操作     |
//   |---------------------------------------|-----------|------|-----------|
//   | ⟳ / ⟲ 回す（1つ固定して残り3つを送る） | 3巡回（偶）| 同じ | 互いに逆   |
//   | ↔ 縦軸の鏡（左右が入れ替わる）         | 互換（奇） | 鏡像 | 自分自身   |
//   | ↕ 横軸の鏡（上下が入れ替わる）         | 互換（奇） | 鏡像 | 自分自身   |
//
// **すべての逆操作が自明なので、最短手数を学習者が自分で数えられる。**
// 180°回転のボタンは置かない（↔ のあと ↕ がちょうど180°回転になるので導出できる）。
// v343〜v361 の「⟳ ＝ 90°回転＋左右反転」は**廃止**した——⟲ が逆にならず
// （続けると180°回転になる）、2回押すと元に戻る＝回転として振る舞わないので、
// 最短手数の土台が成り立たなかった。90°回転・180°回転はレクチャーの題材へ移す。
// **練習モード（'fp'）は据え置き**（分子を変えない操作だけを並べる別のねらい）。
//
// UI は**十字の模型**（renderCross）。各スロットの両側に回転ボタンを置き、
// **押したスロットが「固定する枝」**になる ＝「軸を選ぶ→回す」の2段が1タップになる。
// 外枠の4辺が鏡ボタンで、**左辺・右辺＝縦軸の鏡／上辺・下辺＝横軸の鏡**。
// 辺は4つだが結果は2通りしかない＝**鏡像は1つしかない**と気づくこと自体が学び。
// 押したときに対になる辺が同時に光る（flashMirrorPair）ようにしてある。
//
// 完成の判定は canonicalStereoCode の一致（StereoQuiz.relationOf === 'same'）だけで済み、
// **図の向きが違っていても同じ分子なら完成**とする（見た目ではなく分子で判定する）。
class StereoTimeAttack extends FischerPractice {
    constructor(game) {
        super(game, { prefix: 'ta', modalId: 'time-attack-modal', openBtnId: 'btn-time-attack' });
        if (!this.modal) return;
        this.timerEl = document.getElementById('ta-timer');
        this.modeEl = document.getElementById('ta-mode');
        this.timerId = null;
        this.startTime = null;
        this.finalMs = null;
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.newQuestion());
        // 十字の模型（記号パズルと共通の操作面）。押したスロットが固定軸になる
        this.cross = new CrossModel('ta', {
            labels: () => this.crossLabels(),
            canCycle: (slot, dir) => !!(this.current && !this.finished &&
                fischerOpCycle(this.game, this.current.targetB, this.selCenter, slot, dir)),
            canMirror: (axis) => !!(this.current && !this.finished &&
                fischerOpMirror(this.game, this.current.targetB, this.selCenter, axis)),
            onCycle: (slot, dir) => this.applyCrossCycle(slot, dir),
            onMirror: (axis) => this.applyCrossMirror(axis)
        });
        this.bestBtn = document.getElementById('btn-ta-best');
        this.bestOps = null;
        this._replaying = false;
        if (this.bestBtn) this.bestBtn.addEventListener('click', () => this.replayShortest());
        // 閉じるときはタイマーも止める（ボタン自体の開閉は親クラスが処理する）
        document.getElementById('btn-ta-close').addEventListener('click', () => this.stopTimer());
    }

    newQuestion() {
        this.build();
        this.stopTimer();
        const mode = this.modeEl ? this.modeEl.value : 'all';
        const pool = this.pool.filter(e =>
            mode === '1' ? e.centers === 1
                : (mode === 'multi' || mode === 'advanced') ? e.centers >= 2 : true);
        if (!pool.length) {
            if (this.statusEl) this.statusEl.textContent = 'この範囲で出題できる分子がありません。';
            return;
        }
        // 上級は「**中心を切り替えないと解けない**」お題だけを出す（2026-08-01 ユーザー要望）。
        // 立体の違う中心が2か所以上あるので、①②…を選び直しながら入れ替えることになる。
        // 判定は最短手順の探索に任せる: 最短手順の中で**入れ替える中心が2種類以上**なら合格
        const advanced = mode === 'advanced';
        let q = null;
        for (let tries = 0; tries < (advanced ? 120 : 60) && !q; tries++) {
            const e = pool[Math.floor(Math.random() * pool.length)];
            // お題と立体の違う異性体を、中心の反転で作る（＋見た目も少しかき混ぜる）
            let tB = e.target;
            const centers = this.readableCenters(tB);
            if (advanced && centers.length < 2) continue;
            const flips = advanced
                ? 2 + Math.floor(Math.random() * (centers.length - 1))
                : 1 + Math.floor(Math.random() * centers.length);
            const shuffled = centers.slice().sort(() => Math.random() - 0.5).slice(0, flips);
            for (const ci of shuffled) {
                const r = fischerOpSwap(this.game, tB, ci);
                if (r) tB = r;
            }
            tB = this.scramble(tB, Math.floor(Math.random() * 2));
            const rel = StereoQuiz.relationOf(
                this.game.createTargetFromData({ target: e.target }),
                this.game.createTargetFromData({ target: tB }));
            // メソ体などで反転が打ち消されて同じ分子に戻った場合は出題しない
            if (rel !== 'enantiomer' && rel !== 'diastereomer') continue;
            const cand = { entry: e, targetA: e.target, targetB: tB, base: tB, how: 'attack' };
            if (advanced) {
                const ops = this.shortestSolution(6, 4000, cand);
                if (!ops) continue;
                const used = new Set(ops.filter(o => o.kind === 'mirror').map(o => o.center));
                if (used.size < 2) continue; // 1つの中心だけで解けるものは上級ではない
            }
            q = cand;
        }
        if (!q) {
            if (this.statusEl) this.statusEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.moves = 0;
        this.finished = false;
        this.finalMs = null;
        this.selCenter = null;
        this.selAxis = 'up';
        this.clearBestReplay();
        if (this.taskEl) {
            this.taskEl.textContent =
                `お題: 「${q.entry.name}」。右の図を操作して、左と同じ分子（同じ立体異性体）を作ってください。` +
                '図の向きや並びは違っていて構いません（判定は分子で行います）。' +
                (advanced ? '【上級】立体の違う中心が2か所以上あります。①②… を選び直しながら入れ替えてください。' : '');
        }
        renderMoleculeIntoSvg(this.game, 'ta-svg-a', q.targetA, false);
        this.startTime = Date.now();
        this.timerId = setInterval(() => this.renderTimer(), 100);
        this.refresh(true);
    }

    // 最短手順の再生をしまう（次のお題・やり直しのたびに呼ぶ）
    clearBestReplay() {
        this.bestOps = null;
        this._replaying = false;
        if (this.bestBtn) this.bestBtn.classList.add('hidden');
    }

    // やり直し: 図を最初に戻し、タイマーも仕切り直す
    resetFigure() {
        if (!this.current) return;
        this.current.targetB = this.current.base;
        this.moves = 0;
        this.finished = false;
        this.finalMs = null;
        this.clearBestReplay();
        this.stopTimer();
        this.startTime = Date.now();
        this.timerId = setInterval(() => this.renderTimer(), 100);
        this.refresh(true);
    }

    /** 十字の模型: 押したスロットを固定して残り3つを送る（3巡回＝偶置換。分子は変わらない） */
    applyCrossCycle(slot, dir) {
        if (!this.current || this.finished || this._replaying) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に回す中心（C）を選んでください。';
            return;
        }
        const r = fischerOpCycle(this.game, this.current.targetB, this.selCenter, slot, dir);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    'この回し方はこの図では行えません（枝どうしが重なるか、枝の中の別の不斉炭素原子の読みが壊れるため）。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /** 十字の模型: 外枠の辺の鏡（縦軸＝左右／横軸＝上下の入れ替え。互換1回＝奇置換） */
    applyCrossMirror(axis) {
        if (!this.current || this.finished || this._replaying) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に反転させる中心（C）を選んでください。';
            return;
        }
        const r = fischerOpMirror(this.game, this.current.targetB, this.selCenter, axis);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    `この中心では${axis === 'vertical' ? '縦軸' : '横軸'}の鏡が使えません（枝どうしが重なるため）。` +
                    'もう一方の向きの鏡か、先に回してみてください。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /**
     * お題のかき混ぜは**パズルで押せる操作だけ**（＝スロット固定の3巡回）で行う。
     * 親クラスは 90°回転・180°回転も混ぜるが、それらはパズルから外したので、
     * 学習者が再現できない図から始めることになってしまう。
     */
    scramble(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const centers = this.readableCenters(t);
            if (!centers.length) break;
            const ci = centers[Math.floor(Math.random() * centers.length)];
            const slot = CrossModel.SLOTS[Math.floor(Math.random() * 4)];
            const r = fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw');
            if (r) t = r;
        }
        return t;
    }

    /**
     * お題と、いま操作している図で**立体が食い違っている中心の数**。
     * 回転は分子を変えないので、これがそのまま**最短手数の下限**になる
     * （鏡は1手につきちょうど1つの中心を反転させるため）。
     * 読めない・対応づけできない場合は null（下限を主張しない）。
     */
    mismatchCount(q = this.current) {
        if (!q) return null;
        const molA = this.game.createTargetFromData({ target: q.targetA });
        const molB = this.game.createTargetFromData({ target: q.base });
        const sa = readStereoOf(molA), sb = readStereoOf(molB);
        if (!sa || !sb) return null;
        const cmp = stereoIsomorphismCompare(molA, sa.stereo, molB, sb.stereo);
        if (!cmp || !cmp.centers) return null;
        return cmp.centers.filter(x => !x.match).length;
    }

    /**
     * 最短手順を幅優先で求める（2026-08-01 ユーザー要望「実は最短は…」）。
     *
     * 完成の判定は**分子**で、回転（3巡回＝偶置換）は分子を変えない。だから最短は
     * ふつう「立体が違う中心を鏡で1つずつ反転させる」だけ ＝ 回転は1手も要らない。
     * ただし枝が重なって**両方の鏡が使えない**中心があり、そのときだけ先に回す必要がある。
     *
     * そこで **(1) 鏡だけの探索**を先に走らせる。得られた手数が下限（食い違う中心の数）に
     * 届いていればそれが最短と確定できるので、そこで打ち切る（十字の操作は分岐が多く、
     * 回転まで混ぜた全探索は上級の出題づくりで何度も回すと重すぎる）。
     * 届かなかったときだけ **(2) 回転を混ぜた探索**を、鏡だけの手数より浅い範囲で試す。
     * 図の見た目（drawingKey）で重複を除き、深さと節点数で打ち切る（見つからなければ null）。
     */
    shortestSolution(maxDepth = 6, maxNodes = 4000, q = this.current) {
        if (!q) return null;
        const mirrorOnly = this.searchSolution(q, maxDepth, maxNodes, false);
        const floor = this.mismatchCount(q);
        if (mirrorOnly && floor !== null && mirrorOnly.length <= floor) return mirrorOnly;
        const cap = mirrorOnly ? mirrorOnly.length - 1 : maxDepth;
        return this.searchSolution(q, cap, maxNodes, true) || mirrorOnly;
    }

    /** shortestSolution の本体。withCycles=false なら鏡だけを候補にする */
    searchSolution(q, maxDepth, maxNodes, withCycles) {
        if (!q || maxDepth < 1) return null;
        const molA = this.game.createTargetFromData({ target: q.targetA });
        const isSame = t => StereoQuiz.relationOf(
            molA, this.game.createTargetFromData({ target: t })) === 'same';
        const start = q.base;
        if (isSame(start)) return [];
        const seen = new Set([FischerPractice.drawingKey(start)]);
        let frontier = [{ t: start, ops: [] }];
        let nodes = 0;
        for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                const cands = [];
                this.readableCenters(cur.t).forEach(ci => {
                    ['vertical', 'horizontal'].forEach(axis => {
                        const m = fischerOpMirror(this.game, cur.t, ci, axis);
                        if (m) cands.push({ t: m, op: { kind: 'mirror', center: ci, axis } });
                    });
                    if (!withCycles) return;
                    CrossModel.SLOTS.forEach(slot => {
                        ['cw', 'ccw'].forEach(dir => {
                            const r = fischerOpCycle(this.game, cur.t, ci, slot, dir);
                            if (r) cands.push({ t: r, op: { kind: 'cycle', center: ci, slot, dir } });
                        });
                    });
                });
                for (const c of cands) {
                    if (++nodes > maxNodes) return null;
                    const key = FischerPractice.drawingKey(c.t);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const ops = cur.ops.concat([c.op]);
                    if (isSame(c.t)) return ops;
                    next.push({ t: c.t, ops });
                }
            }
            frontier = next;
        }
        return null;
    }

    /** 手順1つぶんの読み上げ（最短手順の再生で使う） */
    static opLabel(op) {
        if (op.kind === 'mirror') {
            return op.axis === 'vertical' ? '↔ 縦軸の鏡（左右が入れ替わる）'
                                          : '↕ 横軸の鏡（上下が入れ替わる）';
        }
        return `${op.dir === 'cw' ? '⟳' : '⟲'} ${CrossModel.SLOT_JA[op.slot]}を固定して回す`;
    }

    // 最短手順を、お題の最初の図から1手ずつ再生する（自分の手順と見比べるため）
    replayShortest() {
        if (!this.current || !this.bestOps || this._replaying) return;
        this._replaying = true;
        this.current.targetB = this.current.base;
        this.selCenter = null;
        this.refresh(false);
        const total = this.bestOps.length;
        let i = 0;
        const tick = () => {
            if (i >= total) {
                this._replaying = false;
                if (this.statusEl && this._finishText) {
                    this.statusEl.textContent =
                        `▶ 最短手順（${total}手）の再生おわり。あなたは ${this.moves}手でした。\n` + this._finishText;
                    this.statusEl.className = 'result-message success';
                } else {
                    this.updateStatus();
                }
                return;
            }
            const op = this.bestOps[i++];
            this.selCenter = op.center; // どの中心に効かせた手なのかを先に見せる
            const t = op.kind === 'mirror'
                ? fischerOpMirror(this.game, this.current.targetB, op.center, op.axis)
                : fischerOpCycle(this.game, this.current.targetB, op.center, op.slot, op.dir);
            if (t) this.current.targetB = t;
            this.refresh(false);
            if (this.statusEl) {
                this.statusEl.className = '';
                this.statusEl.textContent =
                    `▶ 最短手順の再生（${i}/${total}手）: ${StereoTimeAttack.opLabel(op)}`;
            }
            setTimeout(tick, 950);
        };
        if (this.statusEl) {
            this.statusEl.className = '';
            this.statusEl.textContent = 'お題の最初の図に戻しました。ここから最短手順を再生します。';
        }
        setTimeout(tick, 700);
    }

    stopTimer() {
        if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    }

    renderTimer() {
        if (!this.timerEl) return;
        const ms = this.finished ? this.finalMs : (this.startTime ? Date.now() - this.startTime : 0);
        this.timerEl.textContent = `${((ms || 0) / 1000).toFixed(1)}秒`;
    }

    // 自己ベスト（分子ごと）。localStorage が使えない環境では黙って諦める
    updateRecord(name, ms, moves) {
        let all = {};
        try { all = JSON.parse(localStorage.getItem('chemAssemblerTimeAttack') || '{}') || {}; } catch (e) {}
        const prev = all[name];
        const isNew = !prev || ms < prev.ms;
        if (isNew) {
            all[name] = { ms, moves };
            try { localStorage.setItem('chemAssemblerTimeAttack', JSON.stringify(all)); } catch (e) {}
        }
        return { isNew, ms: isNew ? ms : prev.ms, moves: isNew ? moves : prev.moves };
    }

    updateStatus() {
        if (!this.current) return;
        if (this._replaying) { this.renderTimer(); return; } // 再生中の文言は replayShortest が持つ
        const rel = this.currentRelation();
        if (rel === 'same' && !this.finished) {
            // 完成。タイマーを止め、記録を更新する
            this.finished = true;
            this.finalMs = Date.now() - this.startTime;
            this.stopTimer();
            const best = this.updateRecord(this.current.entry.name, this.finalMs, this.moves);
            const sec = (this.finalMs / 1000).toFixed(1);
            // 「実は最短は…」を出す（2026-08-01 ユーザー要望）。
            // 探索が打ち切られた場合（null）は黙って出さない＝嘘の手数を出さない
            this.bestOps = this.shortestSolution();
            if (this.statusEl) {
                let text =
                    `🏁 完成！「${this.current.entry.name}」と同じ分子になりました（${sec}秒・${this.moves}手）。\n` +
                    (best.isNew ? '🥇 自己ベスト更新！'
                                : `自己ベスト: ${(best.ms / 1000).toFixed(1)}秒・${best.moves}手`);
                if (this.bestOps) {
                    const n = this.bestOps.length;
                    text += `\n実は最短は ${n}手 です（あなたは ${this.moves}手）。` +
                        (this.moves === n ? ' ぴったり最短でした！'
                                          : ' 下のボタンで、お題の最初から最短手順を再生できます。');
                }
                text += '\n図の向きが違っていても、同じ分子なら完成です（判定は図ではなく分子）。';
                this._finishText = text; // 最短手順の再生が終わったら、この要約に戻す
                this.statusEl.textContent = text;
                this.statusEl.className = 'result-message success';
            }
            if (this.bestBtn) this.bestBtn.classList.toggle('hidden', !this.bestOps || !this.bestOps.length);
        } else if (!this.finished) {
            const relText = {
                enantiomer: '鏡像異性体（すべての中心の立体が逆）',
                diastereomer: '別の立体異性体（一部の中心の立体が逆）'
            }[rel] || '別の分子';
            if (this.statusEl) {
                this.statusEl.textContent =
                    `いま右の分子は、お題とは ${relText} です。\n` +
                    '回しても立体異性体は変わりません。立体が違う中心（C）を選び、外枠の「鏡」を押しましょう。';
                this.statusEl.className = '';
            }
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
        this.renderTimer();
    }

    refresh(resetStatus) {
        super.refresh(resetStatus);
        this.renderCross();
    }

    renderCross() {
        if (this.cross) this.cross.render();
    }

    /**
     * 十字に並べるラベル。選んでいる中心の4スロット（**暗黙の H も1つのスロット**）に
     * 置換基の名前を置く。H のところだけ回転ボタンが押せないと十字の模型として
     * 不整合になるので、H もふつうのスロットとして扱う（C-5c）。
     * 出題前・立体が読めないときは null（＝空の十字）。
     */
    crossLabels() {
        const mol = this.current ? this.molB : null;
        const center = (mol && this.selCenter !== null) ? mol.atoms[this.selCenter] : null;
        const slots = center ? fischerSlots(mol, center.id) : null;
        if (!slots) return null;
        const label = k => slots[k] === 'H' ? 'H' : substituentLabel(mol, slots[k], center.id);
        return { up: label('up'), right: label('right'), down: label('down'),
                 left: label('left'), center: 'C' };
    }
}

// ===== 記号パズル（模式化した模型・ORDER_stereo_puzzle.md 第2段） =====
//
// 分子を使わず、4スロットに **A・B・C・D の記号**を置いた抽象モデルで同じ規則を練習する。
//   ・化学の知識が要らない（名前も分子式も出てこない）ので、**規則だけ**に集中できる
//   ・出題は4記号の並べ替え24通りから選ぶだけ ＝ **出題ストックが尽きない**
//   ・判定は**置換だけ**で、分子モデル（正準コード・立体の読み直し）を一切通らない＝軽い
// 操作面は立体タイムアタックと同じ CrossModel を使う。**同じ手つきのまま**、
// 模式モードで規則を覚え、分子モードで実物に当てるため。
//
// **完成の条件は「見本とぴったり同じ並び」**にした（分子モードの「同じ分子なら向きは自由」
// とは違う）。模式モードで偶奇だけを完成条件にすると**鏡を1回押せば必ず終わる**ので、
// C-5c のねらい（逆操作が自明だから最短手数を自分で数えられる）が消えてしまう。
// 偶奇（見本と同じ立体か・鏡像か）は毎手ごとに文言で出し、そちらで規則を教える。
class SymbolPuzzle {
    constructor() {
        this.modal = document.getElementById('symbol-puzzle-modal');
        if (!this.modal) return;
        this.goal = null;   // 見本の並び { up, right, down, left }
        this.start = null;  // お題の最初の並び（やり直し・最短手順の基点）
        this.slots = null;  // いま操作している並び
        this.moves = 0;
        this.finished = false;
        this.taskEl = document.getElementById('sp-task');
        this.statusEl = document.getElementById('sp-status');
        this.movesEl = document.getElementById('sp-moves');
        this.modeEl = document.getElementById('sp-mode');
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on('btn-symbol-puzzle', () => this.open());
        on('btn-sp-close', () => this.modal.classList.add('hidden'));
        on('btn-sp-next', () => this.newQuestion());
        on('btn-sp-reset', () => this.resetFigure());
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.newQuestion());
        this.cross = new CrossModel('sp', {
            labels: () => this.crossLabels(),
            // 模式モデルではどの操作も必ず成立する（枝が重なる・立体が読めない、が無い）。
            // 完成後だけ止める
            canCycle: () => !!this.slots && !this.finished,
            canMirror: () => !!this.slots && !this.finished,
            onCycle: (slot, dir) => this.apply({ kind: 'cycle', slot, dir }),
            onMirror: (axis) => this.apply({ kind: 'mirror', axis })
        });
    }

    open() {
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    /** 1つのスロットを固定して残り3つを送る（3巡回＝偶置換） */
    static cycle(slots, fixedSlot, dir) {
        const ring = CrossModel.SLOTS.filter(k => k !== fixedSlot);
        const step = dir === 'ccw' ? 2 : 1;
        const out = Object.assign({}, slots);
        for (let i = 0; i < 3; i++) out[ring[(i + step) % 3]] = slots[ring[i]];
        return out;
    }

    /** 向かい合う2スロットの入れ替え（互換1回＝奇置換）。縦軸＝左右／横軸＝上下 */
    static mirror(slots, axis) {
        const out = Object.assign({}, slots);
        if (axis === 'horizontal') { out.up = slots.down; out.down = slots.up; }
        else { out.left = slots.right; out.right = slots.left; }
        return out;
    }

    static key(slots) {
        return CrossModel.SLOTS.map(k => slots[k]).join('');
    }

    /**
     * 見本を基準にした置換の偶奇。**偶＝見本と同じ立体**（回転だけで届く）／
     * **奇＝見本の鏡像**（鏡が奇数回必要）。これが模式モデルの判定のすべて。
     */
    static parity(slots, goal) {
        const goalSeq = CrossModel.SLOTS.map(k => goal[k]);
        const perm = CrossModel.SLOTS.map(k => goalSeq.indexOf(slots[k]));
        let swaps = 0;
        for (let i = 0; i < perm.length; i++) {
            while (perm[i] !== i) {
                const j = perm[i];
                perm[i] = perm[j];
                perm[j] = j;
                swaps++;
            }
        }
        return swaps % 2 === 0 ? 'even' : 'odd';
    }

    /** 24通りの並べ替えをすべて作る */
    static allArrangements() {
        const out = [];
        const letters = SymbolPuzzle.SYMBOLS.map(s => s.text);
        const walk = (rest, acc) => {
            if (!rest.length) {
                out.push({ up: acc[0], right: acc[1], down: acc[2], left: acc[3] });
                return;
            }
            rest.forEach((x, i) => walk(rest.filter((_, j) => j !== i), acc.concat([x])));
        };
        walk(letters, []);
        return out;
    }

    newQuestion() {
        const all = SymbolPuzzle.allArrangements();
        this.goal = all[Math.floor(Math.random() * all.length)];
        const want = this.modeEl ? this.modeEl.value : 'all';
        const pool = all.filter(a => {
            if (SymbolPuzzle.key(a) === SymbolPuzzle.key(this.goal)) return false; // 最初から完成は出さない
            const p = SymbolPuzzle.parity(a, this.goal);
            return want === 'same' ? p === 'even' : want === 'mirror' ? p === 'odd' : true;
        });
        this.start = pool[Math.floor(Math.random() * pool.length)];
        this.slots = Object.assign({}, this.start);
        this.moves = 0;
        this.finished = false;
        this.bestOps = null;
        if (this.taskEl) {
            // ⚠ v1468: 「使える手は…まったく同じ4種類」の一本化先はここ（設問側。ux-density §3-c）。
            //    相手を「分子のパズル」から **⏱ 立体タイムアタック** に名指しへ変えた
            //    （行き先が画面のボタン名と一致する ＝ 探せる）
            this.taskEl.textContent =
                '左の見本とぴったり同じ並びになるように、右の十字を操作してください。' +
                '記号そのものに意味はありません（分子の枝の代わり）。' +
                '使える手は ⏱ 立体タイムアタックとまったく同じ4種類です。';
        }
        this.refresh(true);
    }

    resetFigure() {
        if (!this.start) return;
        this.slots = Object.assign({}, this.start);
        this.moves = 0;
        this.finished = false;
        this.bestOps = null;
        this.refresh(true);
    }

    apply(op) {
        if (!this.slots || this.finished) return;
        this.slots = op.kind === 'mirror'
            ? SymbolPuzzle.mirror(this.slots, op.axis)
            : SymbolPuzzle.cycle(this.slots, op.slot, op.dir);
        this.moves++;
        this.refresh(false);
    }

    /** 見本までの最短手順（24通りしかないので幅優先で必ず出る） */
    shortest(from) {
        const start = from || this.start;
        if (!start || !this.goal) return null;
        const goalKey = SymbolPuzzle.key(this.goal);
        if (SymbolPuzzle.key(start) === goalKey) return [];
        const seen = new Set([SymbolPuzzle.key(start)]);
        let frontier = [{ s: start, ops: [] }];
        for (let depth = 1; depth <= 8 && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                const cands = [];
                CrossModel.SLOTS.forEach(slot => ['cw', 'ccw'].forEach(dir =>
                    cands.push({ s: SymbolPuzzle.cycle(cur.s, slot, dir), op: { kind: 'cycle', slot, dir } })));
                ['vertical', 'horizontal'].forEach(axis =>
                    cands.push({ s: SymbolPuzzle.mirror(cur.s, axis), op: { kind: 'mirror', axis } }));
                for (const c of cands) {
                    const k = SymbolPuzzle.key(c.s);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const ops = cur.ops.concat([c.op]);
                    if (k === goalKey) return ops;
                    next.push({ s: c.s, ops });
                }
            }
            frontier = next;
        }
        return null;
    }

    crossLabels() {
        return SymbolPuzzle.labelsOf(this.slots);
    }

    /** 並び1つを十字のラベルに直す（見本・選択肢の静止画にも使う） */
    static labelsOf(slots) {
        if (!slots) return null;
        const color = t => (SymbolPuzzle.SYMBOLS.find(s => s.text === t) || {}).color;
        const at = k => ({ text: slots[k], color: color(slots[k]) });
        return { up: at('up'), right: at('right'), down: at('down'), left: at('left'),
                 center: { text: '＋', color: 'rgba(224,176,255,0.9)' } };
    }

    /** 見本の十字（操作できない静止画） */
    renderGoal() {
        CrossModel.paint(document.getElementById('sp-goal'), SymbolPuzzle.labelsOf(this.goal));
    }

    refresh(resetStatus) {
        this.renderGoal();
        if (this.cross) this.cross.render();
        const matched = this.slots && SymbolPuzzle.key(this.slots) === SymbolPuzzle.key(this.goal);
        if (matched && !this.finished) {
            this.finished = true;
            this.bestOps = this.shortest();
            if (this.cross) this.cross.render(); // 完成したらボタンを止める
        }
        if (this.statusEl) {
            let text;
            if (this.finished) {
                text = `🎯 見本と同じ並びになりました（${this.moves}手）。`;
                if (this.bestOps) {
                    text += `\n最短は ${this.bestOps.length}手 です` +
                        (this.moves === this.bestOps.length ? '。ぴったり最短でした！'
                            : `（あなたは ${this.moves}手）。逆操作はぜんぶ自明なので、数えれば必ず分かります。`);
                }
            } else {
                const p = SymbolPuzzle.parity(this.slots, this.goal);
                text = p === 'even'
                    ? 'いまの並びは見本と「同じ立体」です（回転だけで見本に届きます）。'
                    : 'いまの並びは見本の「鏡像」です（回転だけでは届きません。鏡が奇数回いります）。';
                if (!resetStatus) text += '\n回すと並びは変わりますが、同じ立体か鏡像かは変わりません。';
            }
            this.statusEl.textContent = text;
            this.statusEl.className = this.finished ? 'result-message success' : '';
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
    }
}

// 記号は4つとも別の色にする（どの枝が動いたかを目で追えるように）
SymbolPuzzle.SYMBOLS = [
    { text: 'A', color: '#00f2fe' }, { text: 'B', color: '#ffa502' },
    { text: 'C', color: '#2ecc71' }, { text: 'D', color: '#e056fd' }
];

// ===== 「同じ立体はどれ？」4択（ORDER_stereo_puzzle.md 第3段） =====
//
// **見本1つに対して4つ示し、同じものを選ばせる。** 発注書で最優先とされた出題形式で、
// 理由は **静止画1枚で問いと選択肢が読める**こと（SNS のサムネとして最も強い。IDEAS.md §1）。
//
// 土台は第1段・第2段と同じなので**判定は1本で済む**:
//   ・記号（模式）… 見本を基準にした置換が**偶なら同じ立体**（SymbolPuzzle.parity）
//   ・分子       … StereoQuiz.relationOf === 'same'
// どちらのモードでも「正解は1つ・残り3つは鏡像（またはジアステレオマー）」に揃えてある。
// 正解の解説には**見本から何手で作れるか**を出す（回転だけで届く＝同じ立体、の実演）。
class StereoChoiceQuiz {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('choice-quiz-modal');
        if (!this.modal) return;
        this.kindEl = document.getElementById('pk-kind');
        this.taskEl = document.getElementById('pk-task');
        this.resultEl = document.getElementById('pk-result');
        this.scoreEl = document.getElementById('pk-score');
        this.score = { asked: 0, correct: 0 };
        this.current = null;
        this.pool = null;
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        this.streakEl = document.getElementById('pk-streak');
        this.pairRow = document.getElementById('pk-pair-answer');
        this.pairBtns = ['btn-pk-same', 'btn-pk-diff']
            .map(id => document.getElementById(id)).filter(Boolean);
        this.streak = 0;
        this.pairStats = { n: 0, ms: 0 };
        on('btn-choice-quiz', () => this.open());
        on('btn-pk-close', () => this.modal.classList.add('hidden'));
        on('btn-pk-next', () => this.newQuestion());
        // 「❓ D/L とは」は D/L の出題のときだけ出す（発注書 F-2 の入口）
        this.dlHelpBtn = document.getElementById('btn-pk-dl-explain');
        on('btn-pk-dl-explain', () => { if (window.dlExplain) window.dlExplain.open(); });
        on('btn-pk-same', () => this.answerPair(true));
        on('btn-pk-diff', () => this.answerPair(false));
        // ★ 採点のあとの「見本を実際に動かしてみる」（ハースの出題だけ・DESIGN_sugar.md §1-2c）
        this.turnPanel = document.getElementById('pk-turn');
        this.turnStatusEl = document.getElementById('pk-turn-status');
        on('btn-pk-turn-updown', () => this.applyTurn('updown'));
        on('btn-pk-turn-leftright', () => this.applyTurn('leftright'));
        on('btn-pk-turn-half', () => this.applyTurn('halfturn'));
        on('btn-pk-turn-reset', () => this.applyTurn(null));
        if (this.kindEl) this.kindEl.addEventListener('change', () => this.newQuestion());
        for (let i = 0; i < 4; i++) {
            const cell = document.getElementById(`pk-cell-${i}`);
            if (cell) cell.addEventListener('click', () => this.answer(i));
        }
    }

    open() {
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    /** フィッシャー投影として立体が読める分子（タイムアタックと同じ選び方） */
    build() {
        if (this.pool) return;
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info && !info.fromRing && info.geoms === 0 && info.centers >= 1 &&
                info.stereoCode !== info.mirrorCode) { // アキラルだと「鏡像＝同じ」で誤答が作れない
                this.pool.push(Object.assign({}, e, info));
            }
        });
    }

    /* ======================================================================
     * 「同じ糖の図はどれ？」（ハース環・DESIGN_sugar.md §1-2b 帰結3）
     *
     * ★ 入試の型「マルトースを上下反転した図から正しいものを選ばせる」。
     * ハース図を1つ見せ、**座標変換で作った図**を並べて「同じ分子はどれ？」を選ばせる。
     *
     * ★ **正誤は表に書かず、並べた図から読み直して決める**（`canonicalStereoCode` を
     * 見本と比べるだけ）。だから「この変換は正解」という知識をこのコードは1つも持たない。
     * ⚠ `compounds.json` は読むだけ（1文字も変えない）。
     *
     * **平面図への座標操作と、意味の保存**（§1-2b の表。実測は下の OV/HQ テスト）:
     *   ★ 上下フリップ（y 反転＋面マーク反転） … 向き反転・面反転 → 読みは保存 ＝ 同じ分子
     *   ✗ 左右の鏡映（x 反転）              … 向きだけ反転           ＝ 鏡像の図（L-糖）
     *   ✗ 面内 180° 回転                   … 面だけ反転             ＝ 鏡像の図（L-糖）
     *
     * ⚠⚠ **§1-2b が4つ目に挙げる「面マークを直し忘れた上下反転」は罠にできない。**
     * 面マーク（`haworthFace`）は画面に描かれないので、直し忘れた図は
     * **正しく裏返した図と1画素も違わない絵**になる ＝ 見て選びようがない
     * （§1-3 の「8件のマークはどれも冗長」と同じこと）。読み手に判定させる作りにしたら
     * **この1つが自動的に落ちた** ＝ 3択になる。⚠ これは実測で分かったことで、
     * 4択に揃えるために架空の変換を足したりはしない。
     * ====================================================================== */

    /** ハース図として読む糖の環を持つ登録を集める（＝ chemistry.js の門番をそのまま借りる） */
    buildHaworth() {
        if (this.hwPool) return;
        this.hwPool = [];
        const seen = new Set();
        buildCompoundLibrary(this.game).forEach(e => {
            if (typeof haworthSugarCycles !== 'function') return;
            if (!haworthSugarCycles(e.mol).length) return;
            const info = readStereoOf(e.mol);
            if (!info) return;
            if (seen.has(info.stereoCode)) return;   // 同じ分子の別名エントリは1件だけ
            seen.add(info.stereoCode);
            this.hwPool.push(Object.assign({}, e, info));
        });
    }

    /** 描かれた図の「番号をたどる向き」を日本語で（環ごと。読み直した値で言う） */
    haworthSenseText(target) {
        if (typeof haworthSugarCycles !== 'function') return '';
        const mol = this.game.createTargetFromData({ target });
        const words = haworthSugarCycles(mol)
            .map(c => haworthRingSense(mol, c))
            .map(s => s > 0 ? '時計回り' : s < 0 ? '反時計回り' : '読めない');
        return [...new Set(words)].join('と');
    }

    haworthQuestion() {
        this.buildHaworth();
        if (!this.hwPool.length) return null;
        const codeOf = (t) => {
            const s = readStereoOf(this.game.createTargetFromData({ target: t }));
            return s ? s.stereoCode : null;
        };
        const shape = (t) => t.atoms.map(a => `${a.element}${a.x},${a.y}`).join('|');
        for (let tries = 0; tries < 40; tries++) {
            const e = this.hwPool[Math.floor(Math.random() * this.hwPool.length)];
            const base = e.target;
            const baseCode = codeOf(base);
            if (!baseCode) continue;
            // 座標変換だけで作る。⚠ どれが正解かは、この表ではなく**読み直し**が決める
            const made = [
                { op: 'flip',   label: '上下に裏返した図', target: flipTargetVertically(base) },
                { op: 'mirror', label: '左右を鏡に映した図', target: rotateTargetInPlane(base, 0, true) },
                { op: 'rot180', label: '紙の上で 180° 回した図', target: rotateTargetInPlane(base, 2, false) }
            ];
            // 絵が見分けられない組は出さない（同じ絵が2つ並ぶと問題にならない）
            const shapes = made.map(m => shape(m.target));
            if (new Set(shapes.concat([shape(base)])).size !== made.length + 1) continue;
            made.forEach(m => { m.same = codeOf(m.target) === baseCode; });
            // ★ 正解はちょうど1つ（読み直した結果がそう言っている）。そうでなければ出さない
            if (made.filter(m => m.same).length !== 1) continue;
            const items = made.slice().sort(() => Math.random() - 0.5);
            const N = items.length;
            return {
                kind: 'haworth', entry: e, goal: base, items,
                options: items.map(m => m.target),
                answer: items.findIndex(m => m.same),
                task: `見本は「${e.name}」のハース投影です。①〜${'①②③④'[N - 1]}のうち、` +
                      '見本と同じ分子を描いた図は どれ？' +
                      '（ハース投影は「面の上下」と「炭素番号をたどる向き」の2つがそろって初めて同じ分子です）'
            };
        }
        return null;
    }

    /**
     * D/L の出題に使える図を集める（ORDER 第4段 4a）。
     *
     * **ライブラリに登録されている図だけを使う。鏡像はその場で作らない。**
     * 基準の中心を1つだけ反転させると D/L の文字は確かに裏返るが、**中心が2つ以上ある糖では
     * 別の化合物になる**（D-グルコースの5位だけを逆にしたものは L-グルコースではなく L-イドース）。
     * 解説で名前を出す以上、名乗れない図は出さない。
     * **180°回した図（flipped）も入れない**——「基準が右なら D」がそのままでは逆になる
     * 引っかけで、まずは定義どおりに読む練習にしたいため。
     */
    buildDL() {
        if (this.dlPool) return;
        this.dlPool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const d = assignDLDescriptor(e.mol);
            if (!d || d.flipped) return;
            this.dlPool.push({
                base: e.name.replace(/^[DL]-/, ''), name: e.name,
                target: e.target, letter: d.letter, kind: d.kind
            });
        });
    }

    /** 「D体はどれ？」: 見本は文字だけ。選択肢は4つとも別の化合物にして、規則を当てさせる */
    dlQuestion() {
        this.buildDL();
        for (let tries = 0; tries < 40; tries++) {
            const want = Math.random() < 0.5 ? 'D' : 'L';
            const right = this.dlPool.filter(x => x.letter === want);
            const wrong = this.dlPool.filter(x => x.letter !== want);
            if (!right.length || wrong.length < 3) break;
            const pickRight = right[Math.floor(Math.random() * right.length)];
            // 見た目で区別できるよう、選択肢は**別の化合物**からとる
            const used = new Set([pickRight.base]);
            const others = [];
            wrong.slice().sort(() => Math.random() - 0.5).forEach(x => {
                if (others.length >= 3 || used.has(x.base)) return;
                used.add(x.base);
                others.push(x);
            });
            if (others.length < 3) continue;
            const items = [pickRight].concat(others).sort(() => Math.random() - 0.5);
            return {
                kind: 'dl', want, items,
                goal: { letter: want },
                options: items.map(x => x.target),
                answer: items.findIndex(x => x.letter === want),
                task: `①〜④のうち、${want}体は どれ？ ` +
                      '（基準になる不斉炭素原子で、基準の置換基が右なら D・左なら L です）'
            };
        }
        return null;
    }

    /**
     * 「同じ？違う？」（発注書 第3段の残り）。左右に2つ示して2択で答えさせ、**連続で出して
     * 時間を計る**。判定は4択とまったく同じ（relationOf === 'same'）で、答え方だけ変えたもの。
     * 半分を「同じ（回しただけ）」、半分を「違う（どこかの中心を反転）」で出す。
     */
    pairQuestion() {
        this.build();
        if (!this.pool.length) return null;
        const keyOf = FischerPractice.drawingKey;
        for (let tries = 0; tries < 40; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            const centers = this.centersOf(e.target);
            if (!centers.length) continue;
            const wantSame = Math.random() < 0.5;
            let t = e.target;
            if (!wantSame) {
                const flips = 1 + Math.floor(Math.random() * centers.length);
                centers.slice().sort(() => Math.random() - 0.5).slice(0, flips).forEach(ci => {
                    const r = fischerOpMirror(this.game, t, ci, Math.random() < 0.5 ? 'vertical' : 'horizontal');
                    if (r) t = r;
                });
            }
            t = this.scrambleByCycles(t, 1 + Math.floor(Math.random() * 3));
            const rel = this.relTo(e.target, t);
            // メソ体などで反転が打ち消されることがあるので、**実際の関係で出題を決める**
            const isSame = rel === 'same';
            if (isSame !== wantSame) continue;
            if (isSame && keyOf(t) === keyOf(e.target)) continue; // 図までそっくりでは問題にならない
            return {
                kind: 'pair', entry: e, goal: e.target, options: [t],
                isSame, rel,
                task: `左右は同じ立体異性体でしょうか？（「${e.name}」の図です。向きは違っていて構いません）`
            };
        }
        return null;
    }

    newQuestion() {
        if (this._advance) { clearTimeout(this._advance); this._advance = null; } // 自動送りの取り消し
        const kind = this.kindEl ? this.kindEl.value : 'symbol';
        const q = kind === 'pair' ? this.pairQuestion()
            : kind === 'dl' ? this.dlQuestion()
            : kind === 'haworth' ? this.haworthQuestion()
            : kind === 'molecule' ? this.moleculeQuestion() : this.symbolQuestion();
        if (!q) {
            if (this.taskEl) this.taskEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.answered = false;
        if (this.taskEl) this.taskEl.textContent = q.task;
        this.render();
        if (this.resultEl) { this.resultEl.textContent = ''; this.resultEl.className = ''; }
    }

    /** 記号（模式）の出題: 正解＝偶置換1つ／誤答＝奇置換3つ */
    symbolQuestion() {
        const all = SymbolPuzzle.allArrangements();
        const goal = all[Math.floor(Math.random() * all.length)];
        const gKey = SymbolPuzzle.key(goal);
        const pick = (parity, n) => {
            const c = all.filter(a => SymbolPuzzle.key(a) !== gKey &&
                                      SymbolPuzzle.parity(a, goal) === parity);
            return c.sort(() => Math.random() - 0.5).slice(0, n);
        };
        const right = pick('even', 1);
        const wrong = pick('odd', 3);
        if (right.length < 1 || wrong.length < 3) return null;
        const options = right.concat(wrong).sort(() => Math.random() - 0.5);
        return {
            kind: 'symbol', goal, options,
            answer: options.findIndex(o => SymbolPuzzle.parity(o, goal) === 'even'),
            task: '左が見本です。①〜④のうち、見本と「同じ立体」（回すだけで見本に重ねられるもの）は どれ？'
        };
    }

    /** 分子の出題: 正解＝回転で崩した同じ分子／誤答＝鏡像やジアステレオマー */
    moleculeQuestion() {
        this.build();
        if (!this.pool.length) return null;
        const keyOf = FischerPractice.drawingKey;
        for (let tries = 0; tries < 40; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            const centers = this.centersOf(e.target);
            if (!centers.length) continue;
            const right = this.scrambleByCycles(e.target, 1 + Math.floor(Math.random() * 3));
            // 誤答は「どこかの中心を反転させたもの」＝別の立体異性体。見た目も少し崩す
            const wrong = [];
            for (let k = 0; k < 24 && wrong.length < 3; k++) {
                let t = e.target;
                const flips = 1 + Math.floor(Math.random() * centers.length);
                centers.slice().sort(() => Math.random() - 0.5).slice(0, flips).forEach(ci => {
                    const r = fischerOpMirror(this.game, t, ci, Math.random() < 0.5 ? 'vertical' : 'horizontal');
                    if (r) t = r;
                });
                t = this.scrambleByCycles(t, Math.floor(Math.random() * 3));
                if (this.relTo(e.target, t) === 'same') continue; // 反転が打ち消し合った
                if (wrong.some(w => keyOf(w) === keyOf(t)) || keyOf(t) === keyOf(right)) continue;
                wrong.push(t);
            }
            if (wrong.length < 3) continue;
            if (this.relTo(e.target, right) !== 'same') continue;
            const options = [right].concat(wrong).sort(() => Math.random() - 0.5);
            return {
                kind: 'molecule', entry: e, goal: e.target, options,
                answer: options.findIndex(o => this.relTo(e.target, o) === 'same'),
                task: `左の見本は「${e.name}」です。①〜④のうち、見本と同じ立体異性体は どれ？` +
                      '（図の向きは違っていても構いません）'
            };
        }
        return null;
    }

    relTo(t1, t2) {
        return StereoQuiz.relationOf(this.game.createTargetFromData({ target: t1 }),
                                    this.game.createTargetFromData({ target: t2 }));
    }

    centersOf(target) {
        const mol = this.game.createTargetFromData({ target });
        return Object.keys(readAtomParityFromFischer(mol))
            .map(id => mol.atoms.findIndex(a => a.id === id))
            .filter(i => i >= 0);
    }

    /** パズルで押せる回転（スロット固定の3巡回）だけで図を崩す＝分子は変わらない */
    scrambleByCycles(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const centers = this.centersOf(t);
            if (!centers.length) break;
            const ci = centers[Math.floor(Math.random() * centers.length)];
            const slot = CrossModel.SLOTS[Math.floor(Math.random() * 4)];
            const r = fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw');
            if (r) t = r;
        }
        return t;
    }

    render() {
        const q = this.current;
        const isSymbol = q.kind === 'symbol';
        const clear = (svg) => {
            svg.querySelector('.quiz-bonds').innerHTML = '';
            svg.querySelector('.quiz-atoms').innerHTML = '';
            svg.querySelector('.cross-labels').innerHTML = '';
        };
        const paint = (svgId, data) => {
            const svg = document.getElementById(svgId);
            if (!svg) return;
            const art = svg.querySelector('.pk-cross-art');
            if (art) art.style.display = isSymbol ? '' : 'none';
            if (isSymbol) {
                clear(svg);
                svg.setAttribute('viewBox', '0 0 300 200');
                CrossModel.paint(svg, SymbolPuzzle.labelsOf(data));
            } else {
                clear(svg);
                // 立体のクイズは向きを変えても鎖が一直線のままなので、ここでは畳んでよい
                // （「同じ化合物？」は主鎖を曲げて出すので畳まない。renderMoleculeIntoSvg の但し書き）。
                // ⚠ ハースの出題では畳まない —— 環まわりの縦位置が面（α/β）そのものなので、
                //    図を書き換える処理はどれも入れない
                renderMoleculeIntoSvg(this.game, svgId, data, false, q.kind !== 'haworth');
            }
        };
        if (q.kind === 'dl') {
            // 見本は分子ではなく「D」「L」の文字そのもの（＝これを探せ、というお題）
            const svg = document.getElementById('pk-goal');
            const art = svg.querySelector('.pk-cross-art');
            if (art) art.style.display = 'none';
            clear(svg);
            svg.setAttribute('viewBox', '0 0 300 200');
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', 150); t.setAttribute('y', 128);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'pk-goal-letter');
            t.textContent = `${q.goal.letter}体`;
            svg.querySelector('.cross-labels').appendChild(t);
        } else {
            paint('pk-goal', q.goal);
        }
        q.options.forEach((o, i) => {
            paint(`pk-opt-${i}`, o);
            const cell = document.getElementById(`pk-cell-${i}`);
            if (cell) cell.classList.remove('pk-cell-right', 'pk-cell-wrong');
        });
        // 「同じ？違う？」は図を1つだけ出し、答え方を2択のボタンにする。
        // ⚠ 選択肢の数は出題によって変わる（ハースは3つ）ので、**余った枠は隠す**
        const pair = q.kind === 'pair';
        for (let k = 1; k < 4; k++) {
            const cell = document.getElementById(`pk-cell-${k}`);
            if (cell) cell.classList.toggle('hidden', pair || k >= q.options.length);
        }
        const badge0 = document.querySelector('#pk-cell-0 .pk-badge');
        if (badge0) badge0.textContent = pair ? '' : '①';
        if (this.pairRow) this.pairRow.classList.toggle('hidden', !pair);
        if (this.pairBtns) {
            // 4択と違い、この2つのボタンは作り直されず**居座る**ので、
            // 前の問題の塗り分けを自分で消す（消さないと次の問題に前回の色が残る）
            clearQuizChoiceMarks(this.pairBtns);
        }
        if (this.dlHelpBtn) this.dlHelpBtn.classList.toggle('hidden', q.kind !== 'dl');
        if (this.scoreEl) {
            this.scoreEl.textContent = this.score.asked
                ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
        }
        if (this.streakEl) this.streakEl.textContent = this.streakText();
        // ★ 新しい問題では「動かしてみる」を畳んで、見本を元の図に戻す（採点前は触らせない）
        this.turnOps = [];
        this.turnTarget = null;
        this.syncTurnPanel();
        this.askedAt = Date.now();
    }

    /** 連続正解と平均の解答時間（タイムアタックの手ごたえ） */
    streakText() {
        if (!this.pairStats || !this.pairStats.n) return '';
        const avg = (this.pairStats.ms / this.pairStats.n / 1000).toFixed(1);
        return `連続 ${this.streak} 問正解 ／ 平均 ${avg}秒`;
    }

    /** 「同じ？違う？」の答え合わせ。said=true が「同じ立体」 */
    answerPair(said) {
        const q = this.current;
        if (!q || q.kind !== 'pair' || this.answered) return;
        this.answered = true;
        const ok = said === q.isSame;
        const ms = this.askedAt ? Date.now() - this.askedAt : 0;
        this.pairStats = this.pairStats || { n: 0, ms: 0 };
        this.pairStats.n++;
        this.pairStats.ms += ms;
        this.streak = ok ? (this.streak || 0) + 1 : 0;
        this.score.asked++;
        if (ok) this.score.correct++;
        // 押したものと正解を**ボタンの色で残す**。この2択だけ markQuizChoices を通っておらず、
        // 押せなくなるだけで「どちらを押したか」も「どちらが正解か」も画面に残らなかった
        // （同じクラスの4択側は最初から通っている）。v1021 で立体異性体クイズを直したときの
        // 理由がそのまま当てはまる: **動画では押した瞬間しか手がかりが無い**
        if (this.pairBtns) {
            markQuizChoices(this.pairBtns,
                b => (b.id === 'btn-pk-same') === q.isSame,
                this.pairBtns.find(b => b.id === (said ? 'btn-pk-same' : 'btn-pk-diff')) || null);
        }
        const REL = {
            same: '同じ立体異性体（回しただけの図）',
            enantiomer: '鏡像異性体（すべての中心の立体が逆）',
            diastereomer: '別の立体異性体（一部の中心だけが逆）'
        };
        if (this.resultEl) {
            this.resultEl.textContent =
                (ok ? `⭕ 正解！（${(ms / 1000).toFixed(1)}秒）` : '❌ 不正解。') +
                ` 答えは「${REL[q.rel] || q.rel}」でした。` +
                (q.isSame
                    ? '回す操作（1つ固定して残り3つを送る）だけで重ねられます。'
                    : '回すだけでは重なりません。どこかの中心で左右か上下が入れ替わっています。');
            this.resultEl.className = ok ? 'result-message success' : 'result-message error';
        }
        if (this.scoreEl) this.scoreEl.textContent = `成績: ${this.score.correct} / ${this.score.asked}`;
        if (this.streakEl) this.streakEl.textContent = this.streakText();
        // 連続で出すのがこの形式のねらいなので、正解なら自動で次へ送る
        if (ok) this._advance = setTimeout(() => this.newQuestion(), 1200);
    }

    answer(i) {
        const q = this.current;
        if (!q || this.answered) return;
        this.answered = true;
        const ok = i === q.answer;
        this.score.asked++;
        if (ok) this.score.correct++;
        q.options.forEach((o, k) => {
            const cell = document.getElementById(`pk-cell-${k}`);
            if (!cell) return;
            if (k === q.answer) cell.classList.add('pk-cell-right');
            else if (k === i) cell.classList.add('pk-cell-wrong');
        });
        if (this.resultEl) {
            this.resultEl.textContent = (ok ? '⭕ 正解！ ' : `❌ 不正解。正解は ${'①②③④'[q.answer]} です。 `) +
                this.explain(q, i);
            this.resultEl.className = ok ? 'result-message success' : 'result-message error';
        }
        // D/L では**答え合わせの後だけ**、基準になった不斉炭素を4つとも指す（発注書 F-1）。
        // 出題中に出すと「どの系統か」「どの炭素か」の2段が消えて問題が成り立たない
        // （グルコースは中心が4つあるので、そこを探すこと自体が問い）。
        if (q.kind === 'dl') this.markDLReferences();
        // ★ ハースでは**採点のあとだけ**、見本を自分の手で動かせるようにする（ユーザー発注 2026-08-26）。
        //   採点前に出すと、⇅ を押した図が正解の選択肢に一致してしまう ＝ 答えが分かる
        this.syncTurnPanel();
        if (this.scoreEl) this.scoreEl.textContent = `成績: ${this.score.correct} / ${this.score.asked}`;
    }

    /** 答え合わせの後に、4つの図それぞれの「基準になる不斉炭素」を指す */
    markDLReferences() {
        const q = this.current;
        if (!q || q.kind !== 'dl') return [];
        return q.options.map((t, k) => drawDLReferenceMark(this.game, `pk-opt-${k}`, t));
    }

    explain(q, picked) {
        if (q.kind === 'dl') {
            const RULE = {
                amino: 'α炭素（-NH₂ と -COOH が付いた炭素）の -NH₂',
                sugar: 'カルボニル（-CHO / C=O）からいちばん遠い不斉炭素原子（＝最下位）の -OH',
                hydroxyacid: '-COOH からいちばん遠い不斉炭素原子（＝最下位）の -OH'
            };
            const right = q.items[q.answer];
            let s = `${'①②③④'[q.answer]} は ${right.name}。` +
                `${RULE[right.kind]} が${right.letter === 'D' ? '右' : '左'}にあるので ${right.letter}体です。`;
            if (picked !== q.answer) {
                const p = q.items[picked];
                s += `\n選んだ ${'①②③④'[picked]} は ${p.name}で、${RULE[p.kind]} が` +
                     `${p.letter === 'D' ? '右' : '左'}にあるので ${p.letter}体でした。`;
            }
            s += `\n（ほかは ${q.items.filter((_, k) => k !== q.answer)
                .map(x => `${x.name}＝${x.letter}体`).join('・')}）`;
            // F-1: 図に出した指し棒の読み方。**答え合わせの後にしか出ない**ので、ここで初めて触れる
            s += '\n水色の矢印が、その図で D・L を決めた不斉炭素原子です' +
                 '（糖のように不斉炭素原子が複数あっても、決めるのはこの1つだけ）。';
            return s;
        }
        if (q.kind === 'haworth') return this.haworthExplain(q, picked);
        if (q.kind === 'symbol') {
            const route = this.rotationRoute(q.options[q.answer], q.goal);
            let s = `${'①②③④'[q.answer]} は見本と偶数回の入れ替えぶんだけ違う＝回すだけで見本に重なります`;
            if (route) {
                s += route.length
                    ? `（${route.map(o => `${o.dir === 'cw' ? '⟳' : '⟲'} ${CrossModel.SLOT_JA[o.slot]}を固定`).join(' → ')} の${route.length}手）`
                    : '（見本そのもの）';
            }
            s += '。ほかの3つは左右か上下が1回だけ入れ替わっている＝鏡像で、回しても重なりません。';
            if (picked !== q.answer) {
                s += `\n選んだ ${'①②③④'[picked]} は見本の鏡像です。`;
            }
            return s;
        }
        const rel = { enantiomer: '鏡像異性体', diastereomer: '別の立体異性体（一部の中心だけが逆）' };
        const others = q.options.map((o, k) => k === q.answer ? null : this.relTo(q.goal, o))
            .filter(Boolean);
        let s = `${'①②③④'[q.answer]} は見本を回しただけの図なので、同じ立体異性体です。`;
        s += `ほかの3つは ${[...new Set(others.map(r => rel[r] || r))].join('・')} です。`;
        if (picked !== q.answer) {
            s += `\n選んだ ${'①②③④'[picked]} は見本の ${rel[this.relTo(q.goal, q.options[picked])] || '別の分子'} でした。`;
        }
        return s;
    }

    /**
     * ハースの出題の解説。**正解でも誤答でも「面の上下 × 番号をたどる向き」を言う。**
     * ⚠ 誤答の絵には「何になってしまったか」まで言う（＝ 鏡像異性体・L-糖の図）。
     * 向きは表に持たず、**その図から `haworthRingSense` で読み直した値**を出す。
     */
    haworthExplain(q, picked) {
        const MARK = '①②③④';
        const s0 = this.haworthSenseText(q.goal);
        const why = (m) => {
            const s1 = this.haworthSenseText(m.target);
            const turned = s1 !== s0;
            if (m.same) {
                return `${m.label}です。面（上下）と、番号をたどる向き（${s0} → ${s1}）の` +
                       '両方が逆になったので、2つを掛け合わせた読みは元のまま ＝ 同じ分子です。';
            }
            return `${m.label}です。` + (turned
                ? `番号をたどる向きだけが逆になり（${s0} → ${s1}）、面（上下）はそのままです。`
                : `面（上下）だけが逆になり、番号をたどる向き（${s1}）はそのままです。`) +
                '片方だけなので読みが裏返り、これは鏡像異性体（L-糖）の図になっています。';
        };
        let s = `${MARK[q.answer]} は${why(q.items[q.answer])}`;
        if (picked !== q.answer && q.items[picked]) {
            s += `\n選んだ ${MARK[picked]} は${why(q.items[picked])}`;
        }
        const rest = q.items.map((m, k) => (k === q.answer || k === picked) ? null
            : `${MARK[k]} は${m.label}`).filter(Boolean);
        if (rest.length) {
            s += `\n（${rest.join('・')}` +
                 `——${rest.length > 1 ? 'どちらも' : 'これも'}鏡像異性体の図です）`;
        }
        return s;
    }

    /* ======================================================================
     * ★ 採点のあとに「見本を実際に動かしてみる」（ユーザー発注 2026-08-26）
     *
     * > **採点後に実際に回転を試したい（解説の通りになるか確認）**
     *
     * ⚠ **押せる札はキャンバスの帯と同じ3つ**（⇅ 上下・⇄ 左右・⟳ 180°）。
     *   実体も同じ `chemistry.js` の `flipHaworth` / `haworthTurn`
     *   （受け渡しだけを `haworthTurnedTarget` が埋めている。新しい置き直しは書いていない）。
     *
     * ★ **一致判定に立体コードは使えない。** DESIGN_sugar.md §1-2c のとおり
     *   意味を保つ図は4枚あり、**4枚とも `canonicalStereoCode` は同じ**
     *   ＝ 立体コードでは「どの図になったか」を1つも区別できない。
     *   聞きたいのは「解説どおり、正解の**絵**になったか」なので、
     *   物差しは **`FischerPractice.drawingKey`（平行移動だけ無視した見た目の鍵）**を使う。
     *   ⚠ 軸の取り方は帯と出題側で違う（重原子の重心 ⇔ 全原子の重心）が、
     *     違いは平行移動だけなので `drawingKey` では消える。
     *
     * ★ **「同じ分子のまま」は別の物差しで見ている** —— `haworthTurnedTarget` の中で
     *   `game.haworthStereoFingerprint` が元と食い違ったら図を捨てる（帯と同じ最後の関所）。
     *   ＝ **絵の一致は drawingKey・分子の不変は立体コード**、と役割を分けてある。
     * ====================================================================== */

    /** いま見本の枠に出ている図（動かしていなければ元の図） */
    currentGoalFigure() {
        return this.turnTarget || (this.current ? this.current.goal : null);
    }

    /** 「動かしてみる」の出し入れ。⚠ **ハースの出題で、採点が済んだときだけ出す** */
    syncTurnPanel() {
        if (!this.turnPanel) return false;
        const q = this.current;
        const on = !!(q && q.kind === 'haworth' && this.answered);
        this.turnPanel.classList.toggle('hidden', !on);
        if (!on) {
            this.turnOps = [];
            this.turnTarget = null;
            if (this.turnStatusEl) this.turnStatusEl.textContent = '';
            return false;
        }
        this.updateTurnStatus();
        return true;
    }

    /** 見本の枠に図を描き直す（⚠ ハースなので畳まない＝縦位置が面そのもの） */
    paintGoalFigure(target) {
        const svg = document.getElementById('pk-goal');
        if (!svg) return;
        const art = svg.querySelector('.pk-cross-art');
        if (art) art.style.display = 'none';
        ['.quiz-bonds', '.quiz-atoms', '.cross-labels'].forEach(sel => {
            const g = svg.querySelector(sel);
            if (g) g.innerHTML = '';
        });
        renderMoleculeIntoSvg(this.game, 'pk-goal', target, false, false);
    }

    /**
     * 札を1つ押す（`kind === null` は「↩ 元の図に戻す」）。
     * ⚠ **採点前は何もしない**（答えが分かってしまう）。戻り値 { ok, reason }。
     */
    applyTurn(kind) {
        const q = this.current;
        if (!q || q.kind !== 'haworth' || !this.answered) return { ok: false, reason: 'locked' };
        if (kind === null) {
            this.turnOps = [];
            this.turnTarget = null;
            this.paintGoalFigure(q.goal);
            this.updateTurnStatus();
            return { ok: true, reason: 'reset' };
        }
        const from = this.currentGoalFigure();
        const next = haworthTurnedTarget(this.game, from, kind);
        if (!next) {                       // 最後の関所に跳ねられた（登録16件では起きない）
            if (this.turnStatusEl) {
                this.turnStatusEl.textContent =
                    'この図にはその置き直しを当てられませんでした（図が別の分子になってしまうため、当てずに戻しました）。';
            }
            return { ok: false, reason: 'gate' };
        }
        this.turnOps = (this.turnOps || []).concat([kind]);
        this.turnTarget = next;
        this.paintGoalFigure(next);
        this.updateTurnStatus();
        return { ok: true, reason: 'turned' };
    }

    /**
     * いまの図が「どれと同じ絵か」を言う。
     * ★ ここが発注の芯 ——「解説のとおりになるか」をアプリの側でも言い切る。
     */
    turnStatusText() {
        const q = this.current;
        if (!q || q.kind !== 'haworth') return '';
        const LABEL = { updown: '⇅ 上下に裏返す', leftright: '⇄ 左右に裏返す', halfturn: '⟳ 180°回す' };
        const ops = this.turnOps || [];
        const head = ops.length
            ? `押した手: ${ops.map(k => LABEL[k]).join(' → ')}（${ops.length}手）\n`
            : '見本は元の図のままです。札を押すと、この図が動きます。\n';
        const cur = this.currentGoalFigure();
        const key = FischerPractice.drawingKey(cur);
        if (key === FischerPractice.drawingKey(q.goal)) {
            return ops.length
                ? head + '→ いまの図は元の図と同じ絵です（ここまでの手が打ち消し合いました）。'
                : head.trimEnd();
        }
        const hit = q.items.findIndex(m => FischerPractice.drawingKey(m.target) === key);
        if (hit >= 0) {
            // ⚠ 手の名前は head に出ているので、ここでは「どの手で来たか」を言い直さない
            //   （⇄ → ⟳ の2手でも ⇅ と同じ絵に着く ＝ 四元群。§4-10b KV4）
            return head + `→ いまの図は ${'①②③④'[hit]} とぴったり同じ絵になりました` +
                (hit === q.answer
                    ? '。★ 解説のとおり、これが正解の図です（分子は見本のまま）。'
                    : `。⚠ ${'①②③④'[hit]} は同じ分子ではないはずなので、ここに来たら不具合です。`);
        }
        return head + '→ いまの図は ①〜③ のどれとも違う絵です。' +
            'でも分子は見本のまま ＝ 同じ糖の図は、選択肢に出ている1枚のほかにもあります' +
            '（ハース図で意味を保つ置き直しは ⇅・⇄・⟳ の3つで、元と合わせて4枚あります）。';
    }

    updateTurnStatus() {
        if (this.turnStatusEl) this.turnStatusEl.textContent = this.turnStatusText();
        // ⚠ **1280×720 では、この節はモーダルの見えている範囲より下に出る**（実測: 札の下端 689px・
        //   読み上げる一行は 762px ＝ 画面の外）。押した結果を読む行が見えないと機能が成り立たないので、
        //   出したときと押すたびに**いちばん少ないぶんだけ**スクロールして入れる（`block:'nearest'`
        //   なので、すぐ上の解説の文は画面に残る）
        if (this.turnPanel && !this.turnPanel.classList.contains('hidden') &&
            this.turnPanel.scrollIntoView) {
            this.turnPanel.scrollIntoView({ block: 'nearest' });
        }
    }

    /** 記号モードで「見本まで回転だけで何手か」（12通りしかないので幅優先で必ず出る） */
    rotationRoute(from, goal) {
        const gKey = SymbolPuzzle.key(goal);
        if (SymbolPuzzle.key(from) === gKey) return [];
        const seen = new Set([SymbolPuzzle.key(from)]);
        let frontier = [{ s: from, ops: [] }];
        for (let depth = 1; depth <= 6 && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                for (const slot of CrossModel.SLOTS) {
                    for (const dir of ['cw', 'ccw']) {
                        const s = SymbolPuzzle.cycle(cur.s, slot, dir);
                        const k = SymbolPuzzle.key(s);
                        if (seen.has(k)) continue;
                        seen.add(k);
                        const ops = cur.ops.concat([{ slot, dir }]);
                        if (k === gKey) return ops;
                        next.push({ s, ops });
                    }
                }
            }
            frontier = next;
        }
        return null;
    }
}

/* ===== 「D体・L体の決め方」の説明（発注書 F-2・v1418） =====
 *
 * ユーザー申し立て: 「LDの説明を別モーダルで出せるようにするとよい」。
 * 入口は **D/L の出題を選んでいるときだけ**出す「❓ D/L とは」1つ（`#btn-pk-dl-explain`）。
 * 画面の入口はこれ以上増やさない（`DESIGN_entry_points.md` の方針）。
 *
 * ⚠ **R/S の読み物は既にある**（立体対照ビューの `<details>` の ⑤。`index.html`）。
 * ここは D/L の側の話で、R/S は「別の規則である」ことと**食い違う実例**だけに絞り、
 * 詳しい決め方はあちらへ送る（同じ話を2か所で育てないため）。
 *
 * 図は2枚。**発注書 F-1 と同じ指し棒**（`drawDLReferenceMark`）を、こちらでは
 * 「基準」の札つきで**常時**出す —— 説明の図なので答えを隠す理由が無い。
 *   ・D-グルコース（鎖状）… 不斉炭素が**4つ**あり、そのうち1つだけが基準であることを見せる
 *   ・L-アラニン        … 系統が変われば基準の置換基（-NH₂）も変わることを見せる
 */
class DLExplain {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('dl-explain-modal');
        if (!this.modal) return;
        const close = document.getElementById('btn-dl-explain-close');
        if (close) close.addEventListener('click', () => this.modal.classList.add('hidden'));
        this.painted = false;
    }

    open() {
        if (!this.modal) return;
        this.paint();
        this.modal.classList.remove('hidden');
    }

    /** 例の2枚を描く（ライブラリ確定後にしか描けないので、開いたときに1度だけ） */
    paint() {
        if (this.painted) return;
        const lib = buildCompoundLibrary(this.game);
        const 図 = [['dl-ex-sugar', 'D-グルコース（鎖状）'], ['dl-ex-amino', 'L-アラニン']];
        let 全部描けた = true;
        図.forEach(([svgId, name]) => {
            const e = lib.find(x => x.name === name);
            const svg = document.getElementById(svgId);
            if (!e || !svg) { 全部描けた = false; return; }
            renderMoleculeIntoSvg(this.game, svgId, e.target, false, false);
            const r = drawDLReferenceMark(this.game, svgId, e.target, { label: '基準', pad: 62 });
            if (!r) 全部描けた = false;
        });
        this.painted = 全部描けた;
    }
}

// ===== 立体異性体の総数当て（P12-8 M2.5） =====
//
// 「この分子の立体異性体は何種類？」を4択で答えさせる。ねらいは
// **素朴な 2ⁿ が正しいとは限らない**ことを体験させること。崩れる理由は2通りある。
//   ① メソ体（分子内に対称面）… 酒石酸 2²=4 → 3
//   ② 環などの回転対称        … 乳酸3分子の環状エステル 2³=8 → 4
// 判定は countStereoisomers（chemistry.js）に置く。誤答の選択肢には必ず 2ⁿ を混ぜ、
// 「2ⁿ を選んだ」ときは畳み込みの理由を名指しで解説する。
//
// **出題は「立体の単位 5 個まで」に絞る**（UNIT_LIMIT。v980）。上限を外すと
// ライブラリの二糖4件（マルトース・ラクトース・セロビオース・スクロース）が入り、
// 「答えは 1024 種類」「512 種類」という問題ができる。実測でこれは出題に値しない:
//   - **二糖はどれも畳み込みが起きない**（folded=false・1024=2¹⁰ そのもの）。
//     つまりこのクイズの主眼「2ⁿ が崩れる」にまったく寄与していない
//   - 選択肢が 1023 / 1024 / 1025 / 2048 になり、**2の冪を選ぶだけ**の作業になる。
//     手で数えて確かめることも、畳み込みの有無を吟味することもできない
//   - 糖が出せなくなるわけではない。上限 5 でも鎖状アルドヘキソース（2⁴=16。
//     「16種類」は入試の定番）・ピラノース（2⁵=32）・フルクトフラノース（16）・
//     デオキシリボース（4）・グルコン酸（16）は残る
// 副次的に build() が 14.1 秒 → 0.8 秒になる（二糖4件の数え上げが 13.3 秒だった）が、
// **これは理由ではなく結果**。速さのために題材を削ったのではない。
//
// **高分子も出題しない**（isPolymerFragment。v1020）。実測でプール 159 件のうち2件が
// 高分子で、「ポリアセチレンの立体異性体は 6 種類」「ポリビニルアルコールは 8 種類」を
// 出題していた。これは**繰り返し単位を有限個（このアプリの図では3単位）で切った模型から出た数**で、
// 実物の高分子の立体規則性（イソタクチック／シンジオタクチック／アタクチック）とは別の話。
// **生徒が覚えると害になる数**なので外す。
//   - 重合度 n を明示して作問することは原理的には可能だが、**鎖の反転（頭↔尾）で重なる配置が
//     畳み込まれる**ため単純な 2ⁿ にならない。そこを扱わない限り数字が意味を持たず、
//     扱ったところで高校化学で使い道が無い。ユーザー判断で「外してよい」（2026-08-09）
//   - 判定は**名前に「ポリ」が付くかでは見ない**。見かけで書いた除外は将来必ず嘘をつく
//     （ナイロン66・PET・アルキルベンゼンスルホン酸ナトリウムのように「ポリ」が付かない
//     高分子の図がライブラリにある）。理由で書く ＝ 下の isPolymerFragment を参照
//   - **図そのものは消さない**。名称ライブラリ・付加重合/縮合重合・立体対照ビューでは
//     引き続き使える。外したのは**このクイズの出題プールからだけ**

class StereoCountQuiz {
    constructor(game) {
        this.game = game;
        this.basePool = null;   // 出題できる分子ぜんぶ
        this.pool = null;       // 出題範囲で絞ったもの（basePool の部分集合）
        this.current = null;
        this.score = { asked: 0, correct: 0 };
        this.modal = document.getElementById('count-quiz-modal');
        this.questionEl = document.getElementById('cq-question');
        this.choicesEl = document.getElementById('cq-choices');
        this.resultEl = document.getElementById('cq-result');
        this.scoreEl = document.getElementById('cq-score');
        this.seriesEl = document.getElementById('cq-series');
        const btn = document.getElementById('btn-count-quiz');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-cq-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-cq-next').addEventListener('click', () => this.nextQuestion());
        // 出題範囲（2026-08-09）。命名クイズ・同じ化合物？ には前からあり、ここだけ無かった
        if (this.seriesEl) this.seriesEl.addEventListener('change', () => { this.computePool(); this.nextQuestion(); });
    }

    open() {
        this.build();
        if (this.seriesEl) populateSeriesSelect(this.seriesEl, this.basePool);
        this.computePool();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    /**
     * 出題範囲の絞り込み（2026-08-09）。**他の2つのクイズと同じ規則**にする。
     *
     * 足した理由は2つ。
     * ・**油脂（トリオレイン C₅₇H₁₀₄O₆・重原子63個）のような巨大分子が混じる**と、
     *   図が潰れて読めない。化学として正しい出題なのでプールからは外さず、
     *   **使う側が選べる**ようにするのが筋
     * ・命名クイズ（`naming-series`）と 同じ化合物？（`quiz-series`）には前からあり、
     *   **ここだけ無かった**＝一貫性の穴だった
     *
     * 絞った結果が空になったら全体に戻す（保険。NamingQuiz.computePool と同じ）。
     */
    computePool() {
        if (!this.basePool) return;
        const filter = (this.seriesEl && this.seriesEl.value) || 'all';
        this.pool = this.basePool.filter(p => filter === 'all' || p.series === filter);
        if (this.pool.length === 0) this.pool = [...this.basePool];
    }

    build() {
        if (this.basePool) return;
        this.basePool = [];
        // 重複除けは**コードを1回だけ出して Set で引く**。
        // v925 まで `pool.some(p => p.code === canonicalCode(e.mol))` と書いていたため、
        // 同じ分子の正準コードを**プールの要素数だけ作り直して**いた（O(n²)。
        // 通過 199 件 × プール最大 161 で約1万6千回。実測 1.2 秒ぶん）。
        //
        const seen = new Set();
        buildCompoundLibrary(this.game).forEach(e => {
            // **高分子は出題しない**（2026-08-09・ユーザー検品）。理由は下の isPolymerFragment を参照。
            // 補足: R を含む図の立体を断定しないのは `assignRSDescriptor` の既定方針でもある
            // （chemistry.js「扱わないもの: …R（アルキル基の付け根）を含む図…」）ので、
            // **ここで外すと層をまたいで筋が通る**。
            if (StereoCountQuiz.isPolymerFragment(e.mol)) return;
            const info = countStereoisomers(e.mol, StereoCountQuiz.UNIT_LIMIT);
            // 立体の単位が1個以上あり、数え切れた分子だけを出題する
            if (info.overflow || info.naive < 2) return;
            // 同じ構造式の重複エントリ（D体/L体など）は1つに絞る
            const code = canonicalCode(e.mol);
            if (seen.has(code)) return;
            seen.add(code);
            this.basePool.push(Object.assign({}, e, info, { code }));
        });
        this.computePool();
    }

    /**
     * この図が「高分子の繰り返し単位を切り出したもの」か。
     *
     * 見かけ（名前に「ポリ」が付くか、原子数が多いか）では判定しない。**理由で判定する**:
     * このアプリの図で高分子を高分子にしているのは擬似元素 **`R`（価標1・ELEMENT_VALENCE の 'R'）**
     * ＝「ここから先も同じ繰り返しが続く」という印。R を含む図は有限の1分子ではなく
     * **鎖の一部**なので、そこに現れる立体の単位の数は「図を何単位で切ったか」で変わる
     * ＝ 数え上げた種類数は分子の性質ではなく作図の都合になる。
     * だから R の有無だけを見る。ポリアセチレンにも PET にもナイロン66にも同じ理由で効く。
     *
     * **実害はただ出ていたことではなく、優先されていたこと**: ポリアセチレンは
     * 畳み込み（2³=8 → 6）が起きるので、プールの重み付けが「2ⁿ が崩れる」側を
     * 優先して引く ＝ **このクイズの主眼の例として真っ先に出題されていた**。
     *
     * 判定は**分子の R 原子**で見る（分子式の文字列に /R/ を掛けない）。
     * 式は下付き数字つきの文字列なので、元素記号を部分一致で探すのは事故のもと。
     */
    static isPolymerFragment(mol) {
        return mol.atoms.some(a => a.element === 'R');
    }

    // 選択肢を作る: 正解＋2ⁿ（正解と違うとき）＋近い数。重複を除いて4つに整える
    static buildChoices(info) {
        const set = new Set([info.count]);
        if (info.naive !== info.count) set.add(info.naive);
        [info.count * 2, info.count + 1, Math.max(2, info.count - 1), info.naive + 1]
            .forEach(v => { if (set.size < 4 && v > 1) set.add(v); });
        let n = 2;
        while (set.size < 4) { set.add(info.count + n); n++; }
        return [...set].sort((a, b) => a - b);
    }

    nextQuestion() {
        this.build();
        if (!this.pool.length) { this.resultEl.textContent = '出題できる分子がありません。'; return; }
        // このクイズの要点は「2ⁿ が崩れる場合がある」ことなので、畳み込みが起きる分子を
        // 半々の確率で出す。ライブラリでは該当が少数（酒石酸など）で、
        // 素直に選ぶとほとんど出題されず、ねらいが伝わらない
        const folded = this.pool.filter(p => p.folded);
        const from = (folded.length && Math.random() < 0.5) ? folded : this.pool;
        const q = from[Math.floor(Math.random() * from.length)];
        renderMoleculeIntoSvg(this.game, 'cq-svg', reshapeGeometryForDisplay(this.game, q.target));
        const units = [];
        if (q.centers > 0) units.push(`不斉炭素原子 ${q.centers} 個`);
        if (q.bonds > 0) units.push(`シス/トランスのある C=C ${q.bonds} 本`);
        this.questionEl.textContent =
            `「${q.name}」（${q.formula}）の立体異性体は何種類ありますか？`;
        this.choicesEl.innerHTML = '';
        StereoCountQuiz.buildChoices(q).forEach(v => {
            const b = document.createElement('button');
            b.className = 'primary-btn';
            b.textContent = `${v} 種類`;
            b.dataset.value = String(v);
            b.addEventListener('click', () => this.answer(v, b));
            this.choicesEl.appendChild(b);
        });
        this.current = Object.assign({}, q, { units });
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.updateScore();
    }

    answer(said, clickedBtn) {
        if (!this.current || this.choicesEl.querySelector('button').disabled) return;
        const c = this.current;
        markQuizChoices(this.choicesEl.querySelectorAll('button'),
            b => Number(b.dataset.value) === c.count,
            clickedBtn || [...this.choicesEl.querySelectorAll('button')].find(b => Number(b.dataset.value) === said) || null);
        this.score.asked++;
        const correct = said === c.count;
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'count', correct: correct });
        const head = correct ? '⭕ 正解！' : `❌ 残念…正解は ${c.count} 種類。`;
        this.resultEl.textContent = head + ' ' + this.explain(c, said);
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
    }

    explain(c, said) {
        const base = `立体を決めるところは ${c.units.join('と')}。` +
            `それぞれ2通りなので、単純に数えると 2^${c.centers + c.bonds} = ${c.naive} 通りです。`;
        if (!c.folded) {
            return base + `この分子では重なるものが無いので、そのまま ${c.count} 種類になります。`;
        }
        const picked2n = said === c.naive
            ? '\n※ あなたが選んだのは「単純に数えた 2ⁿ」です。ここが引っかけどころで、'
            : '\nところが実際には ';
        return base + picked2n +
            `${c.naive} 通りのうち何組かは同じ分子で、区別できるのは ${c.count} 種類だけです。\n` +
            '理由は2通りあります。①分子内に対称面があって (R,S) と (S,R) が同じもの（メソ体。酒石酸が代表例）、' +
            '②環などに回転対称があり、数え始める位置が違うだけで同じもの。' +
            'このアプリは、分子を自分自身に重ねる写し方をすべて試して同じものをまとめているので、' +
            'どちらの理由でも正しく数えられます。';
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// 出題する立体の単位の上限（2⁵=32 まで）。理由はクラス上のコメント。
// countStereoisomers はこれを超えると数え上げずに overflow を返し、build() が弾く
StereoCountQuiz.UNIT_LIMIT = 5;

// ===== 命名クイズ（P8-4） =====

class NamingQuiz {
    constructor(game) {
        this.game = game;
        this.library = null;
        this.basePool = null; // 出題可能（名前がトポロジー的に一意）なエントリのindex
        this.pool = null;     // シリーズ絞り込み後
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('naming-modal');
        this.resultEl = document.getElementById('naming-result');
        this.scoreEl = document.getElementById('naming-score');
        this.choicesEl = document.getElementById('naming-choices');
        this.seriesEl = document.getElementById('naming-series');
        this.strengthEl = document.getElementById('naming-strength');
        // 出題範囲の2軸（2026-08-20。ユーザー申し立て「高校範囲を超えている物質もある」）
        this.scopeEl = document.getElementById('naming-scope');
        this.fieldEl = document.getElementById('naming-field');
        this.poolCountEl = document.getElementById('naming-pool-count');
        // 人が触るつまみ（2026-08-20）。崩し方＋誤答の紛らわしさを1つに畳んだもの
        this.diffEl = document.getElementById('naming-difficulty');

        document.getElementById('btn-naming').addEventListener('click', () => this.open());
        document.getElementById('btn-naming-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-naming-next').addEventListener('click', () => this.nextQuestion());
        this.seriesEl.addEventListener('change', () => { this.computePool(); this.nextQuestion(); });
        [this.scopeEl, this.fieldEl].forEach(el => {
            if (el) el.addEventListener('change', () => { this.computePool(); this.nextQuestion(); });
        });
        this.strengthEl.addEventListener('change', () => this.nextQuestion());
        // ⚠ 崩し方への書き戻しは**ここからだけ**（nextQuestion からは呼ばない。
        // 呼ぶと台本が入れた `#naming-strength` を毎回上書きして台本が壊れる）
        if (this.diffEl) {
            this.diffEl.addEventListener('change', () => { this.syncStrength(); this.nextQuestion(); });
        }
    }

    strength() {
        return Number(this.strengthEl.value);
    }

    difficulty() {
        return quizDifficultyOf(this.diffEl ? this.diffEl.value : QUIZ_DIFFICULTY_DEFAULT);
    }

    /** 難易度 → 崩し方（内部パラメータ）へ写す */
    syncStrength() {
        if (this.strengthEl) this.strengthEl.value = String(this.difficulty().strength);
    }

    open() {
        this.build();
        populateSeriesSelect(this.seriesEl, this.library);
        populateScopeSelect(this.scopeEl, this.library);
        populateFieldSelect(this.fieldEl, this.library);
        populateDifficultySelect(this.diffEl);
        this.computePool();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    build() {
        if (this.library) return;
        this.library = buildCompoundLibrary(this.game);
        // 同一トポロジーで別名のエントリ（例: 2-ブテン／シス／トランス）は
        // 「正解が一意に決まらない」ため出題対象から除外する
        this.basePool = [];
        for (let i = 0; i < this.library.length; i++) {
            let ambiguous = false;
            for (let j = 0; j < this.library.length; j++) {
                if (i === j) continue;
                if (this.library[i].name !== this.library[j].name &&
                    this.library[i].formula === this.library[j].formula &&
                    verifyMolecule(this.library[i].mol, this.library[j].mol)) {
                    ambiguous = true;
                    break;
                }
            }
            if (!ambiguous) this.basePool.push(i);
        }
        this.computePool();
    }

    computePool() {
        if (!this.library) return;
        const filter = this.seriesEl.value || 'all';
        const scope = (this.scopeEl && this.scopeEl.value) || QUIZ_SCOPE_DEFAULT;
        const field = (this.fieldEl && this.fieldEl.value) || 'all';
        this.pool = this.basePool.filter(i =>
            (filter === 'all' || this.library[i].series === filter) &&
            entryInQuizScope(this.library[i], scope, field));
        // 図の長さの上限で外れたもの（数だけ画面に出す。→ QUIZ_CHAIN_MAX）。
        // basePool（名前が一意に決まるもの）に限って数える＝出題されうるものだけを数える
        this.oversized = quizOversizedNames(
            this.basePool.map(i => this.library[i]), scope, field, filter);
        // **空になっても全体には戻さない**（2026-08-20 に方針を変えた）。
        // 旧実装は保険として basePool へ戻していたが、それは
        // 「高校範囲に絞ったのに範囲外が出る」に化ける ＝ 今回の申し立てそのもの。
        // 出題できないときは nextQuestion が断り文を出す
        this.renderPoolCount();
    }

    /** いま出題できる件数を画面に出す（絞り込みが効いたことを数で見せる） */
    renderPoolCount() {
        if (!this.poolCountEl) return;
        const n = this.pool ? this.pool.length : 0;
        this.poolCountEl.textContent = n === 0
            ? '⚠ この組み合わせでは出題できる化合物がありません' + quizGroupNote()
            : `いま出題できる: ${n} 件` + quizGroupNote() + quizOversizedNote(this.oversized);
    }

    /**
     * 出題する化合物を名前で指定する（2026-08-09。収録用）。
     *
     * 命名クイズは毎回ライブラリから抽選するので、**範囲を絞ってもどれが出るかは決まらない**。
     * 動画のナレーションが範囲に踏み込んだ話（「となりがオルト」など）をすると、
     * 想定外の分子（置換基のないナフタレン等）が出た瞬間に嘘になる。
     * `StereoQuiz.setForced` と同じ役割を、こちらは**名前**で持たせる。
     * 指定が出題プールに無ければ無視する（絞り込みと衝突しても壊れない）。
     */
    setForced(name) {
        this.forcedName = name || null;
    }

    nextQuestion() {
        if (!this.pool) this.computePool();
        if (!this.pool || this.pool.length === 0) {
            this.choicesEl.innerHTML = '';
            this.resultEl.textContent =
                'いまの絞り込み（範囲・分野・シリーズ' + (quizGroupValue() ? '・官能基' : '') +
                '）では出題できる化合物がありません。どれかを「すべて」に戻してください。';
            this.resultEl.className = '';
            this.renderPoolCount();
            return;
        }
        let idx = this.pool[Math.floor(Math.random() * this.pool.length)];
        if (this.forcedName) {
            const hit = this.pool.find(i => this.library[i].name === this.forcedName);
            if (hit !== undefined) idx = hit;
        }
        const entry = this.library[idx];
        const strength = this.strength();

        // 意図的に正準形でない図: 強度に応じて表記変換を1〜2回かける
        const passes = strength === 0 ? 1 : (strength === 2 ? 2 : 1 + Math.floor(Math.random() * 2));
        let t = entry.target;
        for (let p = 0; p < passes; p++) t = transformCompoundDepiction(t, strength);
        renderMoleculeIntoSvg(this.game, 'naming-svg', t);

        // 選択肢: 正解 + 誤答3つ。**紛らわしさは難易度で決まる**（2026-08-20）。
        // 以前は「同分子式を優先 → 足りなければ他の名前」の一本道だったが、
        // ユーザー申し立て「誤答の選択肢の精度を上げたい（人間が紛らわしいと思うものに）」
        // に対して同分子式は当たりが粗い——C₇H₈O のプールから
        // 「ベンジルアルコール／アニソール／o-クレゾール」が出るのと
        // 「o-／m-／p-クレゾール」が出るのでは難しさがまるで違う。→ pickQuizDistractors
        //
        // **誤答も出題範囲の中から選ぶ**（2026-08-20）。ここを絞らないと、範囲を
        // 「教科書」にしても選択肢に アドレナリン・N-メチル-2-ピロリドン が並び、
        // 申し立て（高校範囲を超えている物質が出る）が半分しか直らない。
        // 範囲の中で3つ作れないときだけライブラリ全体へ広げる（出題が止まるほうが害）
        const scope = (this.scopeEl && this.scopeEl.value) || QUIZ_SCOPE_DEFAULT;
        const field = (this.fieldEl && this.fieldEl.value) || 'all';
        const others = this.library.filter((e, i) => i !== idx && e.name !== entry.name);
        const inScope = others.filter(e => entryInQuizScope(e, scope, field));
        const source = new Set(inScope.map(e => e.name)).size >= 3 ? inScope : others;
        // 同じ名前のエントリ（別表記の重複登録）は1つに畳む＝選択肢に同じ文字列を2つ出さない
        const seenName = new Set([entry.name]);
        const uniq = source.filter(e => !seenName.has(e.name) && (seenName.add(e.name), true));
        const picked = pickQuizDistractors(entry, uniq, this.difficulty().confuse, 3);
        const distractors = picked.map(e => e.name);
        const choices = shuffleArray([entry.name, ...distractors]);
        // `tiers` は回帰テストの物差し（難易度を上げると誤答が紛らわしくなることを数で見る）
        this.current = { entry, choices, answered: false,
                         tiers: picked.map(e => quizDistractorTier(entry, e)) };

        this.choicesEl.innerHTML = '';
        choices.forEach(nameText => {
            const btn = document.createElement('button');
            btn.textContent = nameText;
            btn.className = 'view-btn';
            btn.style.padding = '10px';
            btn.style.fontSize = '13px';
            btn.addEventListener('click', () => this.answer(nameText, btn));
            this.choicesEl.appendChild(btn);
        });
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.updateScore();
    }

    answer(nameText, clickedBtn) {
        if (!this.current || this.current.answered) return;
        this.current.answered = true;
        this.score.asked++;
        const correctName = this.current.entry.name;
        const correct = (nameText === correctName);
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'naming', correct: correct });

        // 選んだものと正解の両方を残す（共通ヘルパー）。
        // 旧実装は枠線と文字色だけを inline で塗っていたが、disabled で薄くなった
        // ボタンの上ではほとんど見えなかった（2026-08-09 の実測）
        markQuizChoices(this.choicesEl.children, b => b.textContent === correctName, clickedBtn);

        const c = this.current;
        const points = describeStructure(c.entry.mol);
        const head = correct
            ? `⭕ 正解！「${correctName}」（分子式 ${c.entry.formula}）です。`
            : `❌ 残念…正解は「${correctName}」（分子式 ${c.entry.formula}）。回転や折れ曲がりに惑わされず、つながり方を順に確認しましょう。`;
        this.resultEl.textContent = `${head}\n構造のポイント: ${points.join('、')}`;
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// テスト（test.html）から参照するための公開。class 宣言は window に載らないため明示する
if (typeof window !== 'undefined') {
    window.StereoQuiz = StereoQuiz;
    window.StereoCountQuiz = StereoCountQuiz;
    window.FischerPractice = FischerPractice;
    window.StereoTimeAttack = StereoTimeAttack;
    window.CrossModel = CrossModel;
    window.SymbolPuzzle = SymbolPuzzle;
    window.StereoChoiceQuiz = StereoChoiceQuiz;
    window.condenseChainForDisplay = condenseChainForDisplay;
    window.findCondensableChainRuns = findCondensableChainRuns;
    window.renderMoleculeIntoSvg = renderMoleculeIntoSvg;
    window.transformCompoundDepiction = transformCompoundDepiction;
    window.reshapeGeometryForDisplay = reshapeGeometryForDisplay;
    window.rotateTargetInPlane = rotateTargetInPlane;
    window.readStereoOf = readStereoOf;
    // 塗り分けの後始末（QS2 が空関数へ差し替えて否定対照にする）
    window.clearQuizChoiceMarks = clearQuizChoiceMarks;
    window.markQuizChoices = markQuizChoices;
    // 出題プールの分野・範囲（QS3〜QS5 と tools/quiz-scope-census.js が同じ定義を見る）
    window.buildCompoundLibrary = buildCompoundLibrary;
    window.compoundFieldOf = compoundFieldOf;
    window.entryInQuizScope = entryInQuizScope;
    window.quizScopeLevelOf = quizScopeLevelOf;
    window.QUIZ_FIELDS = QUIZ_FIELDS;
    window.QUIZ_SCOPE_LEVELS = QUIZ_SCOPE_LEVELS;
    window.QUIZ_SCOPE_DEFAULT = QUIZ_SCOPE_DEFAULT;
    window.QUIZ_NAMED_HEAVY_MAX = QUIZ_NAMED_HEAVY_MAX;
    // 官能基・骨格の軸（E1）。URL `?group=` からだけ指す内部の軸。
    // QG1〜QG5 と tools/quiz-group-census.js が**この1つの定義**を読む
    window.QUIZ_GROUPS = QUIZ_GROUPS;
    window.compoundGroupsOf = compoundGroupsOf;
    window.quizGroupValue = quizGroupValue;
    window.quizGroupNote = quizGroupNote;
    // 名簿の検分（C2）。QN1〜QN3 と tools/quiz-scope-review.js が同じ定義を読む
    window.quizScopeSurveyRows = quizScopeSurveyRows;
    window.quizScopeRejectedNames = quizScopeRejectedNames;
    window.quizScopeTextbookNames = quizScopeTextbookNames;
    // 図の長さの上限（QL1〜QL6 と tools/quiz-size-census.js が同じ物差しを見る）
    window.QUIZ_CHAIN_MAX = QUIZ_CHAIN_MAX;
    window.longestChainOutsideRing = longestChainOutsideRing;
    window.quizOversizedNames = quizOversizedNames;
    window.quizOversizedNote = quizOversizedNote;
    // 難易度（崩し方＋誤答の紛らわしさを畳んだもの）と、誤答の紛らわしさの段（QT1〜QT4）
    window.QUIZ_DIFFICULTY = QUIZ_DIFFICULTY;
    window.QUIZ_DIFFICULTY_DEFAULT = QUIZ_DIFFICULTY_DEFAULT;
    window.quizDifficultyOf = quizDifficultyOf;
    window.quizDistractorTier = quizDistractorTier;
    window.pickQuizDistractors = pickQuizDistractors;
    window.QUIZ_CONFUSE_TIER_MAX = QUIZ_CONFUSE_TIER_MAX;
    // タイムアタックの自己ベスト（QT6 が「立体と別のキー」であることを見る）
    window.QUIZ_TA_KEY = QUIZ_TA_KEY;
    window.QUIZ_TA_MODE = QUIZ_TA_MODE;
    window.QUIZ_TA_LIMIT_MS = QUIZ_TA_LIMIT_MS;
    window.QUIZ_TA_BONUS_MS = QUIZ_TA_BONUS_MS;
    // 逓減（2026-08-26）。QD1〜QD3 と tools/quiz-time-census.mjs が同じ定義を読む
    window.QUIZ_TA_BONUS_STEP_MS = QUIZ_TA_BONUS_STEP_MS;
    window.QUIZ_TA_LABEL = QUIZ_TA_LABEL;
    window.QUIZ_TA_RULE = QUIZ_TA_RULE;
    window.quizTimeAttackBonusMs = quizTimeAttackBonusMs;
    window.quizTimeAttackZeroAt = quizTimeAttackZeroAt;
    window.quizTimeAttackTotalBonusMs = quizTimeAttackTotalBonusMs;
    window.readQuizTimeAttackRecord = readQuizTimeAttackRecord;
    window.SameCompoundQuiz = SameCompoundQuiz;
}
