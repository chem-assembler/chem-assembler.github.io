/**
 * 絞り込みモード（DESIGN_narrowing_mode.md の M1）
 *
 * 分子式と実験結果から構造を決めていく過程を、**候補が何通り残っているか**を見せながら操作させる。
 * 紙の上では絶対に見えない数字を出すのがこのモードの本体で、
 * 「どの実験を先に置くかで効きがまったく違う」ことを体験させる。
 *
 * M1 の範囲（設計書 §9）:
 *   ・制約パネル（分子式・不斉炭素の数・環の有無）
 *   ・条件カードを積む / 外す / 並べ替える
 *   ・各段の候補数と、直前から減った数。**0 のカードは灰色**
 *   ・候補は数と内訳だけ。1通りになったときだけ構造を描く
 *
 * M2 以降（マトリクス・ルート探索・入試問題）はここには入れない。
 *
 * ⚠ **候補を数えるのはアプリの仕事**。人は条件を選ぶだけにする（設計書 §1）。
 * ⚠ 列挙は重原子8個まで。C6H12O（211通り）だけ node で 5.5 秒かかるので
 *    `isomers-baked.json` に焼いて同梱してある（_解析/tools/bake-isomers.js が生成）。
 */

// ---- 分子式のプリセット ----
// 候補数が「多すぎず・少なすぎず」のものを選ぶ。数が難易度そのものになる（設計書 §10 の梯子）
const NARROW_FORMULAS = [
    { key: 'C3H6O', label: 'C3H6O', elements: ['C', 'C', 'C', 'O'], h: 6, hint: '神奈川大 2021-3 と同じ。エノールの扱いが効く' },
    { key: 'C4H10O', label: 'C4H10O', elements: ['C', 'C', 'C', 'C', 'O'], h: 10, hint: 'アルコール4種とエーテル3種' },
    { key: 'C5H12O', label: 'C5H12O', elements: ['C', 'C', 'C', 'C', 'C', 'O'], h: 12, hint: 'アルコールだけで8種' },
    { key: 'C5H10', label: 'C5H10', elements: ['C', 'C', 'C', 'C', 'C'], h: 10, hint: '学習院大 2021-3 と同じ。10通りがアルケン5・環5にきれいに割れる' },
    // M10: 窒素を含む分子。列挙エンジンは最初から N を扱える（足りなかったのはカードだけだった）
    { key: 'C3H7NO2', label: 'C3H7NO2', elements: ['C', 'C', 'C', 'N', 'O', 'O'], h: 7, hint: '関西大 2021-3 iv と同じ。393通りから α-アミノ酸を1つに絞る' },
    // M9: 候補集合が「環への置換基の並べ方」であるもの。重原子11個でも10通りしかない
    {
        key: 'ring6-OH-iPr-Me', label: 'シクロヘキサン環＋−OH・イソプロピル・メチル',
        ring: { size: 6, subs: ['OH', 'iPr', 'Me'] }, elements: [], h: 0,
        hint: '関西大 2021-3 iii と同じ（C10H20O）。重原子11で列挙は届かないが、並べ方は10通り',
    },
    { key: 'C6H12', label: 'C6H12', elements: ['C', 'C', 'C', 'C', 'C', 'C'], h: 12, hint: '九州大 2021 前期4 と同じ。アルケンと環が混ざる' },
    { key: 'C5H10O', label: 'C5H10O', elements: ['C', 'C', 'C', 'C', 'C', 'O'], h: 10, hint: '不飽和度1。環・C=C・C=O の3択が出る' },
    { key: 'C6H12O', label: 'C6H12O', elements: ['C', 'C', 'C', 'C', 'C', 'C', 'O'], h: 12, baked: true, hint: '東大 2021 前期1I と同じ。211通りから始まる' },
    { key: 'C5H10O2', label: 'C5H10O2', elements: ['C', 'C', 'C', 'C', 'C', 'O', 'O'], h: 10, baked: true, hint: '滋賀医大 2021-3 と同じ。酸・エステル・アルコール・アルデヒドが全部入る' },
    { key: 'C4H6O2', label: 'C4H6O2', elements: ['C', 'C', 'C', 'C', 'O', 'O'], h: 6, hint: '熊本大 2021 前3 と同じ。酸・エステル・ラクトンが混ざる' },
    { key: 'C4H8O2', label: 'C4H8O2', elements: ['C', 'C', 'C', 'C', 'O', 'O'], h: 8, hint: 'エステルとカルボン酸が混ざる' },
];

// ---- 条件カード ----
// 文言は**実験の言い方**にする。裏に「＝ 何を言っているか」を出す（設計書 §5）。
// 実験と判定の対応を覚えるのがこのモードの副産物。
// row / cell … **マトリクス（M2）でどの行のどの印になるか**。
// 紙の答案が作っていた表（行が性質・列が化合物）をそのまま画面にするために、
// カードの側に「自分は表のどこを埋めるのか」を持たせる。カードを積むとセルが埋まる。
const NARROW_CARDS = [
    { id: 'na', say: ['ナトリウムを加えると水素が発生した'], mean: '−OH をもつ', row: '−OH', cell: '○', test: (m) => NW.hydroxy(m) },
    { id: 'na-no', say: ['ナトリウムを加えても変化がなかった'], mean: '−OH をもたない', row: '−OH', cell: '×', test: (m) => !NW.hydroxy(m) },
    { id: 'ox1', say: ['酸化するとアルデヒドが得られた'], mean: '第一級アルコール', row: 'アルコールの級', cell: '1級', test: (m) => NW.groups(m).includes('alcohol1') },
    { id: 'ox2', say: ['酸化するとケトンが得られた'], mean: '第二級アルコール', row: 'アルコールの級', cell: '2級', test: (m) => NW.groups(m).includes('alcohol2') },
    { id: 'ox3', say: ['酸化されなかった'], mean: '第三級アルコール', row: 'アルコールの級', cell: '3級', test: (m) => NW.groups(m).includes('alcohol3') },
    { id: 'iodo', say: ['ヨウ素と水酸化ナトリウムで黄色の沈殿が生じた'], mean: 'ヨードホルム陽性（CH3-CO- か CH3-CH(OH)-）', row: 'ヨードホルム', cell: '○', test: (m) => NW.iodoform(m) },
    { id: 'iodo-no', say: ['ヨウ素と水酸化ナトリウムでは沈殿しなかった'], mean: 'ヨードホルム陰性', row: 'ヨードホルム', cell: '×', test: (m) => !NW.iodoform(m) },
    { id: 'silver', say: ['銀鏡反応を示した'], mean: 'アルデヒド', row: 'アルデヒド', cell: '○', test: (m) => NW.groups(m).includes('aldehyde') },
    { id: 'silver-no', say: ['銀鏡反応を示さなかった'], mean: 'アルデヒドでない', row: 'アルデヒド', cell: '×', test: (m) => !NW.groups(m).includes('aldehyde') },
    { id: 'br2', say: ['臭素水を脱色した'], mean: '炭素間二重結合をもつ', row: 'C=C', cell: '○', test: (m) => NW.groups(m).includes('cc_double') },
    { id: 'br2-no', say: ['臭素水を脱色しなかった'], mean: '炭素間二重結合をもたない', row: 'C=C', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') },
    { id: 'h2-no', say: ['水素を付加しなかった'], mean: '不飽和結合をもたない（＝不飽和度は環のぶん）', row: '不飽和結合', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') && !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    { id: 'ether', say: ['加水分解されず、ナトリウムとも反応しなかった'], mean: 'エーテル', row: 'エーテル', cell: '○', test: (m) => NW.groups(m).includes('ether') },
    { id: 'carbonyl-no', say: ['赤外吸収でカルボニル基が見られなかった'], mean: 'C=O をもたない', row: 'C=O', cell: '×', test: (m) => !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    // 光学異性体。**制約パネルの「不斉炭素がちょうど n 個」とは別物**。
    // 問題文の前提（東大「いずれも不斉炭素原子を一つだけもっている」）は制約だが、
    // 実験として「A・F・G には光学異性体が存在した」と言われたらこちらのカードになる（東京都立大2）
    { id: 'optical', say: ['光学異性体が存在した'], mean: '不斉炭素をもつ', row: '光学異性体', cell: '○', test: (m) => NW.chiral(m) >= 1 },
    { id: 'optical-no', say: ['光学異性体は存在しなかった'], mean: '不斉炭素をもたない', row: '光学異性体', cell: '×', test: (m) => NW.chiral(m) === 0 },
    // 環の有無も**カード**。制約パネルにも同じ項目があるが、あちらは問題文の前提用。
    // 「水素を付加しないのに不飽和度が1ある → 環をもつ」は実験からの結論なので、こちら
    { id: 'ring-yes', say: ['環をもつことがわかった'], mean: '環をもつ', row: '環', cell: '○', test: (m) => !!NW.ring(m) },
    { id: 'ring-no', say: ['環をもたないことがわかった'], mean: '環をもたない', row: '環', cell: '×', test: (m) => !NW.ring(m) },
    // 芳香環の有無（2026-08-16）。C7H8O の「ベンゼン環をもつ異性体は何種類か」のように、
    // 芳香族かどうかそのものが問われる。判定は chemistry.js の findAromaticBondKeys
    // （炭素6員環で結合が単・二重の交互＝ケクレになっているか）をそのまま使う。
    // ⚠ **返り値は Set なので `.length` では見られない**（`.size` で見る）。
    //   ここを `.length > 0` と書いて「芳香環が1つも無い」と誤判定した（2026-08-16 実発生）
    { id: 'aromatic-yes', say: ['ベンゼン環（芳香環）をもつことがわかった'], mean: '芳香環をもつ', row: '芳香環', cell: '○', test: (m) => findAromaticBondKeys(m).size > 0 },
    { id: 'aromatic-no', say: ['ベンゼン環（芳香環）をもたないことがわかった'], mean: '芳香環をもたない', row: '芳香環', cell: '×', test: (m) => findAromaticBondKeys(m).size === 0 },
    // オゾン分解（や過マンガン酸カリウムの酸化開裂）で生成物が1種類 ＝ C=C をはさんで左右対称。
    // 九州大 2021 前期4 の決め手。鎖状と分かっていれば「対称」と言い切れる
    { id: 'ozone-one', say: ['オゾン分解すると1種類の化合物だけが得られた'], mean: 'C=C をはさんで左右対称', row: 'オゾン分解', cell: '1種類', test: (m) => NW.ozoneOne(m) },
    { id: 'ozone-two', say: ['オゾン分解すると2種類の化合物が得られた'], mean: 'C=C の左右が違う', row: 'オゾン分解', cell: '2種類', test: (m) => NW.groups(m).includes('cc_double') && !NW.ozoneOne(m) },
    // カルボン酸とエステル。**判定は chemistry.js に前からあった**（carboxyl / ester）が、
    // カードが無いので言えなかった。C4H8O2 のプリセットは「エステルとカルボン酸が混ざる」と
    // 謳っているのに、その2つを分ける手が無い状態だった（熊本大 前3 を入れようとして気づいた）
    { id: 'acid', say: ['水溶液が酸性を示し、炭酸水素ナトリウムで気体が発生した'], mean: 'カルボキシ基をもつ', row: '酸・エステル', cell: '酸', test: (m) => NW.groups(m).includes('carboxyl') },
    { id: 'acid-no', say: ['水溶液は中性だった'], mean: 'カルボキシ基をもたない', row: '酸・エステル', cell: '酸でない', test: (m) => !NW.groups(m).includes('carboxyl') },
    { id: 'ester', say: ['加水分解するとカルボン酸とアルコールが得られた'], mean: 'エステル結合をもつ', row: '酸・エステル', cell: 'エステル', test: (m) => NW.groups(m).includes('ester') },
    // 環状エステル（ラクトン）。加水分解しても分子の数が増えず、−OH と −COOH が同じ分子から出る。
    // エステルの思考ルーチンの②（不飽和度が余ったらラクトンを疑う）がこれ
    { id: 'lactone', say: ['加水分解すると1種類の化合物だけになり、−OH と −COOH をもっていた'], mean: '環状エステル（ラクトン）', row: '酸・エステル', cell: 'ラクトン', test: (m) => NW.groups(m).includes('ester') && !!NW.ring(m) },
    // カルボニルの数。二価アルデヒド（熊本大 前3 の A）のように「2つもつ」が決め手になる
    { id: 'carbonyl2', say: ['還元すると二価のアルコールが得られた'], mean: 'カルボニルを2つもつ', row: 'C=O', cell: '2つ', test: (m) => NW.carbonylCount(m) === 2 },
    { id: 'ketone-no', say: ['還元すると第一級アルコールだけが得られた'], mean: 'ケトンをもたない', row: 'C=O', cell: 'ケトン×', test: (m) => !NW.groups(m).includes('ketone') },
    // ⚠ **ketone-no の裏が無かった**（2026-08-12・神戸大 2021-3 の G・H で露出）。
    // オゾン分解で出た断片が「銀鏡陰性のカルボニル化合物」＝ ケトン、という言い方は定型なのに、
    // 否定側のカードしか無いので積めなかった
    { id: 'ketone', say: ['銀鏡反応を示さず、還元すると第二級アルコールが得られた'], mean: 'ケトンをもつ', row: 'C=O', cell: 'ケトン', test: (m) => NW.groups(m).includes('ketone') },
    // 「直鎖状の〜が得られた」型。**枝分かれを消すのはこれ**で、環の有無とは別の条件。
    // 熊本大 前3 の A は「還元すると直鎖状の二価の第一級アルコール」で、
    // これが無いと 2-メチルプロパンジアールが残る（実測 4 → 1）
    { id: 'straight', say: ['直鎖状の化合物が得られた'], mean: '炭素骨格が枝分かれしていない', row: '骨格', cell: '直鎖', test: (m) => NW.straightChain(m) },
    { id: 'branched', say: ['枝分かれのある化合物が得られた'], mean: '炭素骨格が枝分かれしている', row: '骨格', cell: '枝分かれ', test: (m) => !NW.straightChain(m) && !NW.ring(m) },
    // M11: 対称性を問題文が直接くれる型（慶應理工 2021-3(2)ii）。
    // 「等価なメチル基が3つ」は NMR の言い換えで、**枝の形を1つに固定する強い条件**。
    // 骨格の行に置く（straight / branched と同じ、炭素のつながり方を言っている）
    { id: 'methyl3', say: ['同じ環境にあるメチル基が3つあった'], mean: '等価なメチル基3つ（＝ 三級ブチル基）', row: '骨格', cell: 'メチル3等価', test: (m) => NW.equivMethyl(m).includes(3) },
    // 臭素を付加してできるジブロモ体の不斉炭素の数。**元の分子ではなく付加後で数える**。
    // 熊本大 前3 の B・C の決め手（クロトン酸に Br2 を付けると不斉炭素が2つできる）
    { id: 'dibromo2', say: ['臭素を付加すると不斉炭素原子を2つもつジブロモ体になった'], mean: 'ジブロモ体の不斉炭素が2つ', row: '付加物', cell: 'Br2で不斉2', test: (m) => NW.dibromoChiral(m) === 2 },
    // M8: 反応させた結果を数える（早稲田大 2021-3(1)）。
    // ⚠ **他のカードと性質が違う。** 他は「その分子がどんな性質をもつか」だが、
    // これは「**反応させたら何種類できるか**」。同じ C5H12O のアルコール8種が
    // 1種類・2種類・3種類・0種類に割れるので、性質の判定だけでは絶対に分けられない
    { id: 'dehyd1', say: ['濃硫酸と加熱すると1種類のアルケンだけが得られた'], mean: '脱水生成物が1種類', row: '脱水生成物', cell: '1種', test: (m) => NW.dehydration(m).count === 1 },
    { id: 'dehyd2', say: ['濃硫酸と加熱すると2種類のアルケンが得られた'], mean: '脱水生成物が2種類', row: '脱水生成物', cell: '2種', test: (m) => NW.dehydration(m).count === 2 },
    { id: 'dehyd3', say: ['濃硫酸と加熱すると3種類のアルケンが得られた'], mean: '脱水生成物が3種類', row: '脱水生成物', cell: '3種', test: (m) => NW.dehydration(m).count === 3 },
    { id: 'dehyd-no', say: ['濃硫酸と加熱してもアルケンが得られなかった'], mean: '脱水できない（隣の炭素に H が無い）', row: '脱水生成物', cell: '×', test: (m) => NW.dehydration(m).count === 0 },
    { id: 'dehyd-cis', say: ['得られたアルケンにシス-トランス異性体の組があった'], mean: '脱水生成物にシス-トランスの組がある', row: '脱水生成物', cell: 'シス/トランス', test: (m) => NW.dehydration(m).cisTrans },
    { id: 'dehyd-cis-no', say: ['得られたアルケンにシス-トランス異性体は無かった'], mean: '脱水生成物にシス-トランスの組が無い', row: '脱水生成物', cell: 'シス/トランス無', test: (m) => !NW.dehydration(m).cisTrans && NW.dehydration(m).count > 0 },
    // ⚠ **反応を2つつないだ判定**（脱水 → オゾン分解）。1枚で3通りが1通りになる
    { id: 'dehyd-ozone-ak', say: ['得られたアルケンをオゾン分解するとアルデヒドとケトンが得られた'], mean: '脱水生成物のオゾン分解でアルデヒド＋ケトン', row: 'オゾン分解', cell: 'ald＋ket', test: (m) => NW.dehydOzoneAldKet(m) },
    // M9: 環に置換基を並べる（関西大 2021-3 iii）。
    // ⚠ **並べ方を知らないと判定できないカード**。「どれが枝分かれをもつアルキル基か」は
    // 分子の形からは読めず、ringPlacements が付けた `_nwPlacement` を見る必要がある
    { id: 'ring-adj-oh-br', say: ['−OH と枝分かれをもつアルキル基が、環上の隣り合った炭素に結合していた'], mean: '−OH と枝分かれアルキル基が隣接', row: '環上の位置', cell: 'OH-枝 隣', test: (m) => NW.ringAdjSubs(m, 'OH', 'branched') === true },
    { id: 'ring-adj-oh-st', say: ['−OH と枝分かれをもたないアルキル基が、環上の隣り合った炭素に結合していた'], mean: '−OH と直鎖アルキル基が隣接', row: '環上の位置', cell: 'OH-直 隣', test: (m) => NW.ringAdjSubs(m, 'OH', 'straight') === true },
    { id: 'ring-drop-br-achiral', say: ['枝分かれをもつアルキル基を水素原子に置換すると、不斉炭素原子が無くなった'], mean: '枝分かれアルキル基を H に換えると不斉炭素0', row: '環上の位置', cell: '枝→H で不斉0', test: (m) => NW.ringDropChiral(m, 'branched') === 0 },
    { id: 'ring-drop-st-achiral', say: ['枝分かれをもたないアルキル基を水素原子に置換すると、不斉炭素原子が無くなった'], mean: '直鎖アルキル基を H に換えると不斉炭素0', row: '環上の位置', cell: '直→H で不斉0', test: (m) => NW.ringDropChiral(m, 'straight') === 0 },
    // M10: 窒素を含む分子（関西大 2021-3 iv）。
    // ⚠ **列挙も断片も最初から N を扱えていた**（C3H7NO2 は393通り出るし、アミンも級まで検出される）。
    // 足りなかったのは**カード**のほうで、実験の言い方が1つも無かった
    { id: 'amine', say: ['塩酸に溶けて塩をつくり、水層に移った'], mean: 'アミノ基をもつ（塩基性）', row: 'アミノ基', cell: '○', test: (m) => NW.groups(m).some((g) => g.startsWith('amine')) },
    { id: 'amine-no', say: ['塩酸には溶けなかった'], mean: 'アミノ基をもたない', row: 'アミノ基', cell: '×', test: (m) => !NW.groups(m).some((g) => g.startsWith('amine')) },
    { id: 'amine1', say: ['第一級アミンだった'], mean: '−NH₂（第一級アミン）', row: 'アミノ基', cell: '1級', test: (m) => NW.groups(m).includes('amine1') },
    { id: 'amide', say: ['酸や塩基で加水分解するとアミンとカルボン酸を生じた'], mean: 'アミド結合をもつ', row: 'アミド', cell: '○', test: (m) => NW.groups(m).includes('amide') },
    { id: 'amide-no', say: ['加水分解されなかった'], mean: 'アミド結合をもたない', row: 'アミド', cell: '×', test: (m) => !NW.groups(m).includes('amide') },
    // ニンヒドリンは**α-アミノ酸**を見る。−NH₂ と −COOH が同じ炭素に付いていること
    // ⚠ **青紫になるのは第一級のα-アミノ酸だけ。** 第二級（プロリン型）は黄色で、
    // 「ニンヒドリンで青紫」と言われたら第二級は候補から外れる。実測でも
    // C3H7NO2 の α-アミノ酸2件のうち1件は第二級（N-メチルグリシン）で、ここで割れる
    { id: 'ninhydrin', say: ['ニンヒドリン溶液を加えて温めると青紫色に呈色した'], mean: '第一級のα-アミノ酸（−NH₂ と −COOH が同じ炭素）', row: 'アミノ基', cell: 'α-アミノ酸', test: (m) => NW.alphaAmino(m) && NW.groups(m).includes('amine1') },
    { id: 'ninhydrin-no', say: ['ニンヒドリン溶液では青紫色にならなかった'], mean: '第一級のα-アミノ酸ではない', row: 'アミノ基', cell: 'α×', test: (m) => !(NW.alphaAmino(m) && NW.groups(m).includes('amine1')) },
    { id: 'nitro-yes', say: ['ニトロ基をもつ'], mean: '−NO₂', row: 'アミノ基', cell: 'ニトロ', test: (m) => NW.groups(m).includes('nitro') },
];

// 環の大きさ（設計書 §5「骨格」）。東大 2021 前期1I の問イ「四員環をもつもの」がこれで、
// **実験だけでは 3 通りまでしか絞れず、ここで初めて 1 つに決まる**。
//
// ⚠ **3〜8員環まで用意する。** 五・六員環だけでは足りない:
//   ・C6H12O（東大の分子式）には既に 7員環が1つ含まれる（酸素を環に取り込んだオキセパン型）
//   ・入試でも7員環以上はときどき出る
// 上限が8なのは **列挙エンジンが重原子8個までしか扱えない**ため（9員環は原理的に作れない）。
// 大きい分子の環は列挙ではなく配分エンジン（M5）で扱うが、そちらは環の**大きさ**を持たない。
const RING_KANJI = { 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八' };
for (let n = 3; n <= 8; n++) {
    NARROW_CARDS.push({
        id: `ring${n}`, say: [`${RING_KANJI[n]}員環をもつ`], mean: `${n}員環`,
        row: '環の大きさ', cell: `${n}員`,
        test: (m) => { const c = NW.ring(m); return !!c && c.length === n; },
    });
}
// 表の行の並び。カードに出てこない行は出さない
const NARROW_ROWS = ['−OH', 'アルコールの級', 'C=O', 'アルデヒド', 'C=C', '不飽和結合', 'エーテル', 'ヨードホルム', '光学異性体', '環', '環の大きさ', 'オゾン分解', '酸・エステル', '骨格', '付加物', '脱水生成物'];

// ---- タグ（発注書 ORDER_features_2026-08-15.md §D） ----
// カードが 58 枚あって探せない、という指摘への答え。**排他的な「群」ではなくタグにする。**
//
// ⚠ **1枚のカードが複数のタグに出る**のが要点。ヨードホルム陽性は CH3-CO- と CH3-CH(OH)- の
// 両方を指すので、**アルコールにもアルデヒド・ケトンにも**実際どちらでもある。
// 排他的に分けようとすると必ず割り切れないものが出る ＝ タグは絞り込みの道具であって分類学ではない。
//
// ⚠ **問題に依存しない分け方にする。**「この問題では冗長」を一覧の段階で判定してはいけない
// （答えを先に見せることになり、絞り込みの面白さが消える）。冗長・重複は**積んだあとに**言う（M3）。
const NARROW_TAGS = ['構造', '分子式', 'アルコール', 'アルデヒド・ケトン', '反応性', '酸・塩基', '窒素', '立体'];

// **タグは行（row）単位で付ける。** 同じ行のカードは同じことを訊いていて（○ と × の違いしかない）、
// タグも同じでよい。58枚に1枚ずつ書くと、足したカードだけタグが抜ける事故が起きる。
const NARROW_ROW_TAGS = {
    '−OH': ['アルコール'],
    'アルコールの級': ['アルコール'],
    // ★ ここが「1枚が複数のタグに出る」実例。上の注記を参照
    'ヨードホルム': ['アルコール', 'アルデヒド・ケトン'],
    'アルデヒド': ['アルデヒド・ケトン'],
    'C=O': ['アルデヒド・ケトン'],
    'エーテル': ['アルコール'],
    'C=C': ['構造', '反応性'],
    // 「水素を付加しなかった」は不飽和度の話 ＝ 分子式から言えることを確かめる手
    '不飽和結合': ['分子式', '反応性'],
    '環': ['構造'],
    '環の大きさ': ['構造'],
    '芳香環': ['構造'],
    '骨格': ['構造'],
    '環上の位置': ['構造', '立体'],
    'オゾン分解': ['分子式', '反応性'],
    '酸・エステル': ['酸・塩基', '反応性'],
    '脱水生成物': ['反応性'],
    '光学異性体': ['立体'],
    '付加物': ['立体', '反応性'],
    'アミノ基': ['窒素', '酸・塩基'],
    'アミド': ['窒素', '反応性'],
};
// `tags` はカード側にも書ける（行と違う付け方をしたくなったとき）。既定は行のタグ
NARROW_CARDS.forEach((c) => { c.tags = c.tags || NARROW_ROW_TAGS[c.row] || []; });

// パレットに出す行の並び。**カードの並び順そのまま**（別に台帳を持つと、
// カードを足したのに行が出ない／空の行が出る、という食い違いが起きる）。
// ⚠ NARROW_ROWS（マトリクスの行）とは別物。あちらは表に出す行だけを選んだ一覧
const NARROW_ROW_ORDER = [...new Set(NARROW_CARDS.map((c) => c.row))];

/**
 * カードの実験文。**配列で持つ**（発注書 §D の「① 同値な表現」＝ 2層化の残り）。
 *
 * `test`（制約の実体）は1つのまま、`say`（言い換え）だけを増やせるようにしてある。
 * 銀鏡反応とフェーリング反応はどちらも「アルデヒド」なので、
 * **行を増やさずに** 2つめの言い方を足せる ＝ カードは制約の数だけで済む。
 * いまはどれも1要素だが、検索は**全要素**に当たるので、足した瞬間から引けるようになる。
 */
const cardSays = (c) => (Array.isArray(c.say) ? c.say : [c.say]);
/** 画面に出す代表の実験文（1つめ） */
const cardSay = (c) => cardSays(c)[0];
/** 検索に当てる文字列。**実験文（全要素）と意味の両方**（発注書 §D-4） */
const cardHaystack = (c) => [...cardSays(c), c.mean].join('\n');
/**
 * 部分一致の絞り込み。
 * 実験の言い方から探す人（「ヨウ素と水酸化ナトリウム」）と
 * 意味から探す人（「ヨードホルム」）の**どちらも通す**のが条件。
 */
function cardMatches(c, query, tag) {
    if (tag && !(c.tags || []).includes(tag)) return false;
    const q = String(query || '').trim().toLowerCase();
    if (!q) return true;
    return cardHaystack(c).toLowerCase().includes(q);
}

/**
 * 配分エンジン（M5・設計書 §3-A）。不飽和度と酸素を**部品に割り振る**組合せを数える。
 *
 * 構造そのものは作らないので**分子の大きさによらず一瞬で終わる**。
 * 列挙エンジンが届かない芳香族はここで扱う。しかもこれは、人が実際に最初にやる作業
 * （不飽和度6 ＝ ベンゼン環4 ＋ C=O 1 ＋ C=C 1）そのもの。
 *
 * ⚠ エステルの問題はこの順で考える（ユーザー指摘・2026-08-08）:
 *   ① 酸素の数から**価数**を決める（エステル結合1つで酸素2個）
 *   ② 不飽和度が余っていれば**環状エステル（ラクトン）**を疑う
 *   ③ 2価以上なら**結合の向き**を考える（並びが3通りある）
 *   ④ 2価以上なら加水分解の生成物が **1:1 とはかぎらない**
 * ①②はこのエンジンが数え上げる。③④は構造の話なので、注意書きとして画面に出す。
 */
const ALLOT_PARTS = [
    { name: 'ベンゼン環', dou: 4, o: 0 },
    { name: '脂肪族の環', dou: 1, o: 0 },
    { name: 'C=C', dou: 1, o: 0 },
    { name: 'C≡C', dou: 2, o: 0 },
    { name: 'エステル結合', dou: 1, o: 2 },
    { name: 'カルボキシ基', dou: 1, o: 2 },
    { name: '酸無水物', dou: 2, o: 3 },
    { name: 'ケトン', dou: 1, o: 1 },
    { name: 'アルデヒド', dou: 1, o: 1 },
    { name: 'ヒドロキシ基', dou: 0, o: 1 },
    { name: 'エーテル結合', dou: 0, o: 1 },
];

/**
 * 分子式を C・H・O・N の個数に読む。
 *
 * ⚠ **扱えない元素は黙って捨てない。** 以前は正規表現に当たらない元素を素通りさせていたので、
 * C2H5Cl を入れると C2H5 として計算され、**誤った断片の分子式が出た**。
 * 気づけないまま「重原子4個だから列挙できます」と案内してしまう。
 * 読めなかった元素は `unknown` に集め、呼び出し側で断る。
 */
function parseFormula(f) {
    const m = { C: 0, H: 0, O: 0, N: 0, unknown: [] };
    const re = /([A-Z][a-z]?)(\d*)/g;
    let g;
    while ((g = re.exec(f))) {
        if (!g[1]) continue;
        if (m[g[1]] !== undefined && g[1] !== 'unknown') m[g[1]] += (g[2] ? +g[2] : 1);
        else m.unknown.push(g[1]);
    }
    return m;
}
/** 読めない元素が混ざっていないか。混ざっていたらその一覧を返す */
const formulaUnknown = (f) => parseFormula(f).unknown;

/** 分子式（＋条件）から部品の割り振りを全部挙げる。opts: {benzene, require, forbid} */
function allotUnsaturation(formula, opts = {}) {
    const mol = parseFormula(formula);
    const dou = (2 * mol.C + 2 + mol.N - mol.H) / 2;
    if (!Number.isInteger(dou) || dou < 0) return { error: `不飽和度が整数になりません（${dou}）`, dou };
    const usable = ALLOT_PARTS.filter((p) => !(opts.forbid || []).includes(p.name));
    const out = [];
    (function walk(i, rd, ro, picked) {
        if (rd === 0 && ro === 0) {
            if (opts.benzene !== undefined && opts.benzene !== '' && (picked['ベンゼン環'] || 0) !== +opts.benzene) return;
            if (opts.require && !picked[opts.require]) return;
            out.push({ ...picked });
            return;
        }
        if (i >= usable.length || rd < 0 || ro < 0) return;
        const p = usable[i];
        const max = Math.min(p.dou ? Math.floor(rd / p.dou) : 8, p.o ? Math.floor(ro / p.o) : 8, 8);
        for (let n = 0; n <= max; n++) {
            if (n) picked[p.name] = n; else delete picked[p.name];
            walk(i + 1, rd - p.dou * n, ro - p.o * n, picked);
        }
        delete picked[p.name];
    })(0, dou, mol.O, {});
    return { dou, oxygen: mol.O, rows: out };
}

/**
 * 断片に割る（M6・設計書 DESIGN_fragment_split.md）。
 *
 * 列挙は重原子8個までしか届かない。大きい分子はまず**断片の分子式に割って**、
 * 小さくなったところで列挙に渡す。3問を数えたところ、この「割る手」が 41% を占めていた
 * （配分は 14%）。断片は7つ中4つが重原子8個以下に落ちる。
 *
 * 割り算は分子式の足し引きだけで、構造は作らない（作れない大きさだから断片にしている）。
 */
const FRAG_OPS = {
    hydrolysis: { label: '加水分解（エステル）', add: { H: 2, O: 1 }, times: 'valence', move: 'ester-hydrolysis' },
    ozonolysis: { label: 'オゾン分解（C=C を切る）', add: { O: 1 }, times: 2, move: 'ozonolysis' },
    none: { label: '割らない（引き算だけ）', add: {}, times: 0, move: 'fragment-from-molecular-weight' },
};
/** 式量を引ける官能基。順に引いて残りの骨格を出す（fragment-from-molecular-weight） */
const FRAG_GROUPS = { '−COOH': 45, '−OH': 17, '−CHO': 29, '−NH2': 16, 'C6H5−': 77, '−COO−': 44, '−CH3': 15 };
/** 整数の原子量。式量から組成を探すときに使う（小数だと候補がぶれる） */
const FRAG_MASS = { C: 12, H: 1, O: 16 };

const fragAdd = (a, b, k = 1) => {
    const r = { C: a.C || 0, H: a.H || 0, O: a.O || 0, N: a.N || 0 };
    // 'unknown'（読めなかった元素の一覧）は数ではないので足し引きに混ぜない
    ['C', 'H', 'O', 'N'].forEach((e) => { r[e] += (b[e] || 0) * k; });
    return r;
};
// ⚠ **元素の並びはヒル式**（C・H のあとは残りをアルファベット順 ＝ N が O より先）。
// 入試の表記もこれ。以前は C・H・O・N の順で `C18H19O3N` と出しており、
// 生徒が問題文の `C18H19NO3` と見比べられなかった
const fragShow = (m) => ['C', 'H', 'N', 'O']
    .map((e) => (m[e] ? e + (m[e] > 1 ? m[e] : '') : '')).join('');
const fragHeavy = (m) => (m.C || 0) + (m.O || 0) + (m.N || 0);
const fragDou = (m) => (2 * (m.C || 0) + 2 + (m.N || 0) - (m.H || 0)) / 2;
const fragOk = (m) => ['C', 'H', 'O', 'N'].every((e) => (m[e] || 0) >= 0)
    && Number.isInteger(fragDou(m)) && fragDou(m) >= 0;

/**
 * もとの分子式から、分かっている断片を引いて残りを出す。
 * op ぶんの原子（加水分解なら H2O、オゾン分解なら O）を先に足してから引く。
 */
function fragmentRest(whole, known, op, valence) {
    const spec = FRAG_OPS[op] || FRAG_OPS.none;
    const n = spec.times === 'valence' ? (valence || 1) : spec.times;
    let t = fragAdd(parseFormula(whole), spec.add, n);
    known.forEach((k) => { t = fragAdd(t, parseFormula(k), -1); });
    return fragOk(t) ? t : null;
}

/**
 * 式量が合う組成を全部出す。
 *
 * ⚠ **1つに決め打ちしない。** 「残り57」を C4H9 と決めると C3H5O（C=O ひとつぶん不飽和）を落とす
 * （`fragment-from-molecular-weight` の注意書きにある取りこぼし）。
 *
 * ⚠ **置換基は分子ではない。** 一価の断片は H が奇数で、不飽和度の式 (2C+2−H)/2 が
 * 半端な値になる（C3H5O なら 1.5）。付け根に H を1つ足して分子に閉じてから数える。
 *
 * dou を渡すとそこまで絞る。**配分エンジンが出す「残りの不飽和度」がこれ**で、
 * 実測では4件すべてが1つに決まった。ここが M5 と M6 のつなぎ目。
 */
function fragmentCompositions(mass, { substituent = true, dou = null, maxC = 12, maxO = 4 } = {}) {
    const out = [];
    for (let c = 1; c <= maxC; c++) {
        for (let o = 0; o <= maxO; o++) {
            for (let h = 0; h <= 2 * c + 2; h++) {
                if (c * FRAG_MASS.C + h * FRAG_MASS.H + o * FRAG_MASS.O !== mass) continue;
                // 閉じてから不飽和度を見る。0 未満・炭素数超は価標が成立しない（C3H9O2 を落とす）
                const d = (2 * c + 2 - (substituent ? h + 1 : h)) / 2;
                if (!Number.isInteger(d) || d < 0 || d > c) continue;
                if (dou !== null && d !== dou) continue;
                out.push({ C: c, H: h, O: o, N: 0, dou: d });
            }
        }
    }
    return out;
}

// ---- M7: 元素分析から分子式へ ----
// 2022年版の構造決定6問を読んだところ、**3問が元素分析から始まっていた**
// （兵庫県立大・工5／関西大3 iii／甲南大3）。topic「元素分析，分子式の決定」は
// 12巻で40問あり、そこに載らない問題も同じ入口を使う。構造決定でいちばん多い出だし。
//
// ⚠ ここは**測定値**を扱うので、他のエンジンと性質が違う。
// 列挙も配分も断片も入力は整数（分子式）だが、こちらは小数で、しかも丸めた値が来る。
// 「割り切れない」を黙って整数に丸めると、**誤った分子式を自信を持って出す**ことになる。
// 割り切れなさは隠さずに出す。

/** 燃焼の質量から各元素の質量を出す。単位は問わない（mg でも g でも比は同じ） */
function eaMasses(sample, co2, h2o) {
    const C = co2 * 12 / 44;
    const H = h2o * 2 / 18;
    const O = sample - C - H;
    return { C, H, O };
}

/**
 * 物質量比を最も簡単な整数比に直す。
 *
 * ⚠ **最小で割るだけでは足りない。** 甲南大3 は C:H = 0.75 : 1.0 で、
 * 最小で割ると 1 : 1.333 にしかならない。3倍して初めて 3 : 4 になる。
 * だから 1〜`maxMul` 倍を順に試し、**全部が整数に十分近くなった最初の倍率**を採る。
 *
 * `tol` は測定値の丸め由来のずれをどこまで許すか。有効数字3桁の入試の値なら
 * 0.04 で足りることを実測3件で確認した（もっと緩めると別の比まで拾ってしまう）。
 */
function eaSimplestRatio(moles, { maxMul = 12, tol = 0.04 } = {}) {
    const els = Object.keys(moles).filter((k) => moles[k] > 1e-9);
    if (!els.length) return null;
    // ⚠ **割る相手は「最小」ではなく「酸素」にする**（ユーザー指摘・2026-08-10）。
    // 入試に出る有機物は酸素がいちばん少ないのがふつうなので、**O が 1 になるように規格化**すると
    // 人が紙でやる手順と同じ形になり、出てくる数字も答案と突き合わせられる。
    // 酸素を含まない炭化水素のときだけ最小で割る（甲南大3 の型）。
    // どちらで割っても最簡比は同じだが、**途中の数字が答案と揃うかどうか**が違う
    const base = moles.O > 1e-9 ? moles.O : Math.min(...els.map((k) => moles[k]));
    const min = base;
    for (let mul = 1; mul <= maxMul; mul++) {
        const raw = els.map((k) => moles[k] / min * mul);
        // ずれは**絶対値でなく比で**見る。炭素数が大きいほど丸め誤差も大きくなるため
        if (raw.every((v) => Math.abs(v - Math.round(v)) <= tol * Math.max(1, v / 4))) {
            const r = {};
            els.forEach((k, i) => { r[k] = Math.round(raw[i]); });
            // 出た比がさらに約分できるなら約分する（2倍して 4:10:2 になる類）
            const g = els.map((k) => r[k]).reduce((a, b) => { while (b) { [a, b] = [b, a % b]; } return a; });
            if (g > 1) els.forEach((k) => { r[k] = r[k] / g; });
            return r;
        }
    }
    return null;
}

/** 組成式の式量 */
const eaUnitMass = (r) => (r.C || 0) * 12 + (r.H || 0) * 1 + (r.O || 0) * 16 + (r.N || 0) * 14;

/**
 * 窒素則（ユーザー指摘・2026-08-10）。**H の偶奇・分子量の偶奇・N の個数の偶奇は同じ1つの条件。**
 *
 * ハロゲンを含まない C・H・O・N の分子で、
 *   不飽和度 (2C + 2 + N − H)/2 が整数 ⇔ **H ≡ N (mod 2)**
 *   分子量 = 12C + H + 16O + 14N で、12C・16O・14N はどれも偶数 ⇔ **分子量 ≡ H (mod 2)**
 * よって **分子量の偶奇がそのまま N の個数の偶奇を教える**。
 *
 * 使いどころ: 分子量146 のアミノ酸 → 146 は偶数 → N は偶数個 → アミノ酸なので 0 ではありえず
 * **2個**（リシン C6H14N2O2）。分子量だけで窒素の数が決まる。
 * 関西大3 iv の C18H19NO3 は分子量297 ＝ 奇数で、N が1個であることと整合する。
 */
const eaNitrogenParity = (mass) => (Math.round(mass) % 2 === 0 ? 'even' : 'odd');

/**
 * 組成式を何倍すれば分子式になるか、**成り立つ n をぜんぶ出す**（ユーザー指摘・2026-08-10）。
 *
 * 落とす条件は3つ。どれも価標が成立しないものを外すだけで、化学の知識は要らない:
 *   ① H ≡ N (mod 2)  … 窒素則。N を含まなければ H は偶数
 *   ② 不飽和度が 0 以上・炭素数以下
 *   ③ 酸素の数が下限以上（`minO`。エステルの加水分解が言えれば O は2個以上、など）
 *
 * ①②の効きは実測で大きい。組成式 C2H5O・分子量300以下は、条件なしなら 1〜6倍の6通りだが、
 * **①②だけで 2倍（C4H10O2）の1通りに決まる**（4倍・6倍は不飽和度が負になる）。
 */
function eaCandidateN(ratio, { max = null, exact = null, minO = 0 } = {}) {
    const unit = eaUnitMass(ratio);
    if (!(unit > 0)) return [];
    const hi = exact !== null ? Math.round(exact / unit) : Math.floor((max || 0) / unit);
    const out = [];
    for (let n = 1; n <= Math.max(hi, 0); n++) {
        const C = (ratio.C || 0) * n, H = (ratio.H || 0) * n;
        const O = (ratio.O || 0) * n, N = (ratio.N || 0) * n;
        if ((H - N) % 2 !== 0) continue;                    // ① 窒素則
        const dou = (2 * C + 2 + N - H) / 2;
        if (!Number.isInteger(dou) || dou < 0 || dou > C) continue;   // ②
        if (O < minO) continue;                             // ③
        out.push({ n, C, H, O, N, dou, mass: unit * n });
    }
    return out;
}

/**
 * 気体の状態方程式から分子量を出す（甲南大3）。
 * 体積は L・圧力は Pa・温度は ℃ で受ける（入試の書き方に合わせる）。
 */
function eaMolarMassFromGas({ mass, volumeL, tempC, pressurePa, R = 8.31e3 }) {
    const T = tempC + 273;
    if (!(T > 0) || !(pressurePa > 0) || !(volumeL > 0) || !(mass > 0)) return null;
    // R = 8.31e3 Pa·L/(mol·K) なので体積は L のまま入れられる
    const n = pressurePa * volumeL / (R * T);
    return n > 0 ? mass / n : null;
}

/**
 * 元素分析を通しで解く。返すのは**過程ぜんぶ**（画面が途中の数字を見せるため）。
 *
 * `molarMass` の渡し方は3通り。入試の出方に対応する:
 *   数値      … 「分子量は74であった」→ 倍率 n を割り算で出す
 *   {max: N} … 「分子量は300以下である」→ 収まる最大の n を採る（関西大3 iii）
 *   null     … まだ分からない → 組成式まで
 */
function elementalAnalysis({ sample, co2, h2o, molarMass = null, minO = 0 }) {
    const out = { ok: false, mass: null, moles: null, ratio: null, unit: null, formula: null, warn: [] };
    if (!(sample > 0) || !(co2 >= 0) || !(h2o >= 0)) { out.warn.push('試料・CO₂・H₂O の質量を入れてください'); return out; }
    const mass = eaMasses(sample, co2, h2o);
    out.mass = mass;
    if (mass.C + mass.H - sample > sample * 0.02) {
        out.warn.push('C と H の合計が試料より重くなりました。入力を確かめてください');
        return out;
    }
    // ⚠ **酸素ゼロと入力ミスを区別する。** 甲南大3 は炭化水素なので O がちょうど 0 になる。
    // 測定値の丸めで少し負に振れることがあるので、試料の 2% までは 0 とみなす
    if (mass.O < 0) {
        if (-mass.O <= sample * 0.02) { mass.O = 0; out.noOxygen = true; }
        else { out.warn.push('酸素の質量が負になりました。試料の質量か測定値が合いません'); return out; }
    } else if (mass.O <= sample * 0.02) { mass.O = 0; out.noOxygen = true; }

    const moles = { C: mass.C / 12, H: mass.H / 1, O: mass.O / 16 };
    out.moles = moles;
    const ratio = eaSimplestRatio(moles);
    if (!ratio) { out.warn.push('簡単な整数比になりません。測定値を確かめてください'); return out; }
    out.ratio = ratio;
    out.unit = eaUnitMass(ratio);

    if (molarMass === null || molarMass === undefined || molarMass === '') { out.ok = true; return out; }
    if (typeof molarMass === 'object' && molarMass.max) {
        // 「分子量は N 以下」型（関西大3 iii）。**1つに決め打ちしない。**
        // H の偶数条件と不飽和度の条件で落として、残った候補をぜんぶ出す
        const cand = eaCandidateN(ratio, { max: molarMass.max, minO: minO });
        if (!cand.length) {
            out.warn.push(`上限 ${molarMass.max} に収まる倍率がありません（組成式の式量 ${out.unit}）`);
            return out;
        }
        out.candidates = cand;
        out.maxUsed = true;
        if (cand.length > 1) {
            out.n = cand[cand.length - 1].n;
            out.warn.push('上限だけでは ' + cand.map((x) => `${x.n}倍(分子量${x.mass})`).join('・')
                + ' が残ります。ここでは最大を採りました');
        } else out.n = cand[0].n;
    } else {
        // 窒素則は分子量が分かった時点で使える（組成比とは独立の情報）
        out.nParity = eaNitrogenParity(molarMass);
        const q = molarMass / out.unit;
        out.n = Math.round(q);
        if (Math.abs(q - out.n) > 0.05) {
            out.warn.push(`分子量 ${molarMass} が組成式の式量 ${out.unit} で割り切れません（${q.toFixed(2)} 倍）`);
            return out;
        }
        if (out.n < 1) { out.warn.push(`分子量 ${molarMass} が組成式の式量 ${out.unit} より小さいです`); return out; }
    }
    out.formula = { C: (ratio.C || 0) * out.n, H: (ratio.H || 0) * out.n, O: (ratio.O || 0) * out.n, N: 0 };
    out.ok = true;
    return out;
}

// ---- M9: 環に置換基を並べる ----
// 関西大 2021-3 iii（メントール C10H20O）が動機。重原子11個で**列挙エンジンは届かない**が、
// 届かないのは**組合せ爆発**が理由であって、解析ができないわけではない。
// 「シクロヘキサン環に −OH・イソプロピル・メチルが1つずつ」まで問題文が絞ってくれているので、
// **並べ方だけ数えて分子を1つずつ組み立てれば**、重原子の数によらず扱える。
// 6×5×4＝120 通りを環の対称（回転・反転）で割ると10通り程度にしかならない。
//
// これは配分エンジン（M5）と同じ思想 —— 構造を全部つくらず、**問題文が与えた枠**の中だけ数える。

/** 置換基の小さな図書館。`c` は炭素数、`build` は付け根に生やす手順 */
const RING_SUBS = {
    OH: { label: '−OH', c: 0, o: 1, build: (m, at) => { const o = m.addAtom('O', 0, 0); m.addBond(at, o.id, 1); } },
    Me: { label: 'メチル', c: 1, branched: false, chain: [1] },
    Et: { label: 'エチル', c: 2, branched: false, chain: [2] },
    nPr: { label: 'プロピル（直鎖）', c: 3, branched: false, chain: [3] },
    iPr: { label: 'イソプロピル', c: 3, branched: true, chain: [1, 1, 1] },
    nBu: { label: 'ブチル（直鎖）', c: 4, branched: false, chain: [4] },
    sBu: { label: 'sec-ブチル', c: 4, branched: true, chain: [2, 1, 1] },
    iBu: { label: 'イソブチル', c: 4, branched: true, chain: [1, 1, 2] },
    tBu: { label: 'tert-ブチル', c: 4, branched: true, chain: [1, 1, 1, 1] },
};

/** 置換基を1つ、環の原子 `at` に生やす */
function ringAddSub(m, at, id) {
    const s = RING_SUBS[id];
    if (!s) return;
    if (s.build) { s.build(m, at); return; }
    // chain の書き方: [n] は直鎖 n 個、それ以外は「付け根の炭素に枝を生やす」
    if (id === 'Me' || id === 'Et' || id === 'nPr' || id === 'nBu') {
        let prev = at;
        for (let i = 0; i < s.c; i++) { const a = m.addAtom('C', 0, 0); m.addBond(prev, a.id, 1); prev = a.id; }
        return;
    }
    const root = m.addAtom('C', 0, 0);
    m.addBond(at, root.id, 1);
    if (id === 'iPr') { for (let i = 0; i < 2; i++) { const a = m.addAtom('C', 0, 0); m.addBond(root.id, a.id, 1); } return; }
    if (id === 'tBu') { for (let i = 0; i < 3; i++) { const a = m.addAtom('C', 0, 0); m.addBond(root.id, a.id, 1); } return; }
    if (id === 'sBu') {   // −CH(CH3)−CH2−CH3
        const me = m.addAtom('C', 0, 0); m.addBond(root.id, me.id, 1);
        const c1 = m.addAtom('C', 0, 0); m.addBond(root.id, c1.id, 1);
        const c2 = m.addAtom('C', 0, 0); m.addBond(c1.id, c2.id, 1);
        return;
    }
    if (id === 'iBu') {   // −CH2−CH(CH3)2
        const c1 = m.addAtom('C', 0, 0); m.addBond(root.id, c1.id, 1);
        for (let i = 0; i < 2; i++) { const a = m.addAtom('C', 0, 0); m.addBond(c1.id, a.id, 1); }
        return;
    }
}

/**
 * 環（飽和・単環）に置換基を並べる。**同じ分子になる並べ方は1つにまとめる。**
 *
 * `subs` は置換基 id の配列（重複可）。`ringSize` は環の炭素数。
 * 返り値は `{ mol, pos, code }` の配列で、`pos[i]` が subs[i] を付けた環の位置（0起点）。
 *
 * まとめ方は**環の対称を手で書かず、正準コードで見る**。回転・反転を数え上げると
 * 置換基が同じもの同士のときに二重に落とす事故が起きるので、`canonicalCode` に任せる
 * （同じ判定が2か所に増えないという意味でも、この方が安全）。
 */
function ringPlacements(ringSize, subs) {
    const out = [];
    const seen = new Set();
    const idx = [];
    const rec = (k) => {
        if (k === subs.length) {
            const m = new Molecule();
            const ring = [];
            for (let i = 0; i < ringSize; i++) ring.push(m.addAtom('C', 0, 0).id);
            for (let i = 0; i < ringSize; i++) m.addBond(ring[i], ring[(i + 1) % ringSize], 1);
            subs.forEach((s, i) => ringAddSub(m, ring[idx[i]], s));
            let code;
            try { code = canonicalCode(m); } catch (e) { return; }
            if (seen.has(code)) return;
            seen.add(code);
            // **どの置換基がどこに付いたか**を分子に持たせる。
            // 「−OH と枝分かれアルキル基が隣り合う」「枝分かれアルキル基を H に換える」は
            // 分子の形からは読み取れない（どれが「枝分かれをもつアルキル基」かは並べ方の情報）
            m._nwPlacement = { ringSize, subs: subs.slice(), pos: idx.slice(), ring: ring.slice() };
            out.push({ mol: m, pos: idx.slice(), code, ring });
            return;
        }
        for (let p = 0; p < ringSize; p++) {
            if (idx.includes(p)) continue;   // 1つの環炭素に2つは付けない（問題文がそう言うときだけ使う）
            idx[k] = p;
            rec(k + 1);
        }
        idx.length = k;
    };
    rec(0);
    return out;
}

/** 並べ方の環の位置が隣り合っているか（0起点・環状に見る） */
const ringAdjacent = (a, b, n) => ((a - b + n) % n === 1) || ((b - a + n) % n === 1);

/**
 * 置換基を1つ H に置き換えた分子を作る（関西大 iii 実験:「枝分かれアルキル基を水素に置換した化合物B」）。
 * **同じ並びのまま1つだけ外す**ので、ringPlacements をやり直してはいけない
 * （やり直すと位置関係が失われ、別の分子を見てしまう）。
 */
function ringDropSub(m, dropIndex) {
    const pl = m._nwPlacement;
    if (!pl) return null;
    const sub = new Molecule();
    const ring = [];
    for (let i = 0; i < pl.ringSize; i++) ring.push(sub.addAtom('C', 0, 0).id);
    for (let i = 0; i < pl.ringSize; i++) sub.addBond(ring[i], ring[(i + 1) % pl.ringSize], 1);
    pl.subs.forEach((s, i) => { if (i !== dropIndex) ringAddSub(sub, ring[pl.pos[i]], s); });
    return sub;
}

/** 並べ方のうち、`kind` に当てはまる置換基の添字（'branched' / 'straight' / 'OH'） */
function ringSubIndex(m, kind) {
    const pl = m._nwPlacement;
    if (!pl) return -1;
    return pl.subs.findIndex((s) => {
        const d = RING_SUBS[s];
        if (!d) return false;
        if (kind === 'OH') return s === 'OH';
        if (kind === 'branched') return d.c > 0 && d.branched === true;
        if (kind === 'straight') return d.c > 0 && d.branched === false;
        return false;
    });
}

/** 見出しに入れる文字列の逃がし（データ由来の文字が HTML に混ざらないように） */
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 述語で使う小道具。chemistry.js の関数をそのまま使う（新しい化学ロジックは書かない） */
const NW = {
    groups(m) {
        if (!m._nwGroups) {
            try { m._nwGroups = findFunctionalGroups(m).map((x) => x.type || x.name); } catch (e) { m._nwGroups = []; }
        }
        return m._nwGroups;
    },
    ring(m) {
        if (m._nwRing === undefined) m._nwRing = findAnyCycle(m) || null;
        return m._nwRing;
    },
    /**
     * −OH をもつか（ナトリウムと反応するか）。
     *
     * ⚠ **エノールを数え落とさないこと。** `findFunctionalGroups` は C=C に直結した −OH を
     * `alcohol1/2/3` ではなく `enol` として返すので、`startsWith('alcohol')` だけで見ると
     * エノールが「−OH をもたない」側に落ちる。エノールにも −OH はあるのでナトリウムとは反応する。
     * 神奈川大 2021-3 で、候補が 1 通りに決まるべきところが 3 通り残って気づいた。
     */
    hydroxy(m) {
        const g = NW.groups(m);
        return g.some((x) => x.startsWith('alcohol')) || g.includes('enol');
    },
    /**
     * 炭素骨格が直鎖か（枝分かれが無く、環も無い）。
     * 「還元すると直鎖状のアルコールが得られた」型の条件で使う。
     * ⚠ 炭素だけを見る。O は主鎖の判定に入れない
     */
    straightChain(m) {
        if (NW.ring(m)) return false;
        return m.atoms.filter((a) => a.element === 'C')
            .every((a) => m.getNeighbors(a.id).filter((n) => n.atom.element === 'C').length <= 2);
    },
    /**
     * C=C に臭素を付加してできるジブロモ体の不斉炭素の数。
     * ⚠ **元の分子ではなく付加後の分子で数える**。ここを取り違えると絞り込みが効かない。
     * C=C が1本でないときは -1（この判定の前提が崩れる）。
     */
    dibromoChiral(m) {
        const dbl = m.bonds.filter((b) => {
            if (b.type !== 2) return false;
            const a1 = m.atoms.find((a) => a.id === b.atomId1);
            const a2 = m.atoms.find((a) => a.id === b.atomId2);
            return a1 && a2 && a1.element === 'C' && a2.element === 'C';
        });
        if (dbl.length !== 1) return -1;
        const sub = new Molecule();
        const map = {};
        m.atoms.forEach((a) => { map[a.id] = sub.addAtom(a.element, a.x, a.y).id; });
        m.bonds.forEach((b) => sub.addBond(map[b.atomId1], map[b.atomId2], b === dbl[0] ? 1 : b.type));
        [dbl[0].atomId1, dbl[0].atomId2].forEach((id) => {
            const br = sub.addAtom('Br', 0, 0);
            sub.addBond(map[id], br.id, 1);
        });
        return sub.atoms.filter((a) => a.element === 'C' && sub.isAsymmetricCarbon(a.id)).length;
    },
    /**
     * 分子内脱水（濃硫酸・加熱）で生じるアルケンを数える（M8・早稲田大 2021-3(1)）。
     *
     * ⚠ **今までのカードと性質が違う。** 他は「その分子がどんな性質をもつか」を見るが、
     * これは「**反応させたら何種類できるか**」を見る。同じ C5H12O のアルコールでも
     * 1種類・2種類・3種類に割れるので、性質の判定だけでは絶対に分けられない。
     *
     * 数え方は入試の数え方に合わせる:
     *   **構造の違うアルケンを数え、そのうち C=C がシス-トランスを生むものは2つと数える。**
     * 鏡像異性体は分けない（脱水で両方できるので「別の生成物」とは言わない）。
     *
     * 実測（C5H12O のアルコール8種）:
     *   1種類 … 1-ペンタノール / 2-メチル-1-ブタノール / 3-メチル-1-ブタノール
     *   2種類 … 3-ペンタノール（2つともシス-トランスの組）/ 2-メチル-2-ブタノール / 3-メチル-2-ブタノール
     *   3種類 … 2-ペンタノール（うち2つがシス-トランスの組）
     *   0種類 … 2,2-ジメチル-1-プロパノール（隣の炭素に H が無く脱水できない）
     *
     * 返り値 { count, cisTrans, codes } —— cisTrans はシス-トランスの組ができたか
     */
    dehydration(m) {
        if (m._nwDehyd) return m._nwDehyd;
        const res = { count: 0, cisTrans: false, codes: [] };
        const seen = new Map();
        m.atoms.filter((a) => a.element === 'O').forEach((o) => {
            // −OH（酸素が炭素1つとだけ結合し、残りは水素）に限る。エーテルは脱水しない
            const on = m.getNeighbors(o.id);
            if (on.length !== 1 || on[0].type !== 1 || on[0].atom.element !== 'C') return;
            const alpha = on[0].atom;
            m.getNeighbors(alpha.id).forEach((nb) => {
                if (nb.atom.element !== 'C' || nb.type !== 1) return;
                const beta = nb.atom;
                if (m.getFreeValency(beta.id) < 1) return;   // 隣の炭素に H が無ければ脱水できない
                // α−OH を外し、α=β を二重結合にした分子を作る
                const sub = new Molecule();
                const map = {};
                m.atoms.forEach((a) => { if (a.id !== o.id) map[a.id] = sub.addAtom(a.element, a.x, a.y).id; });
                m.bonds.forEach((b) => {
                    if (b.atomId1 === o.id || b.atomId2 === o.id) return;
                    const isNew = (b.atomId1 === alpha.id && b.atomId2 === beta.id)
                        || (b.atomId2 === alpha.id && b.atomId1 === beta.id);
                    sub.addBond(map[b.atomId1], map[b.atomId2], isNew ? 2 : b.type);
                });
                let code;
                try { code = canonicalCode(sub); } catch (e) { return; }
                if (seen.has(code)) return;
                // その C=C がシス-トランスを生むか。**新しくできた二重結合だけを見る**
                let geo = false;
                try {
                    geo = stereoUnitsOf(sub).bonds.some((pair) => {
                        const s = new Set(pair);
                        return s.has(map[alpha.id]) && s.has(map[beta.id]);
                    });
                } catch (e) { geo = false; }
                seen.set(code, geo);
            });
        });
        seen.forEach((geo, code) => {
            res.codes.push(code);
            res.count += geo ? 2 : 1;
            if (geo) res.cisTrans = true;
        });
        m._nwDehyd = res;
        return res;
    },
    /**
     * 脱水生成物をオゾン分解すると、アルデヒドとケトンが1つずつ得られるか（早稲田大 2021-3(1) 実験2）。
     *
     * ⚠ **反応を2つつないだ判定**。脱水 → オゾン分解と進めてから官能基を見る。
     * 早稲田では、脱水生成物が1種類の3つのアルコールを、これ1枚で1つに絞っている
     * （1-ペンタノールと3-メチル-1-ブタノールは両方ともアルデヒド2つになる）。
     */
    dehydOzoneAldKet(m) {
        const d = NW.dehydration(m);
        if (d.count !== 1 || d.codes.length !== 1) return false;
        // 生成物をもう一度作る（codes には構造が入っていないので作り直す）
        const prod = NW._dehydOne(m);
        if (!prod) return false;
        const dbl = prod.bonds.filter((b) => {
            if (b.type !== 2) return false;
            const a1 = prod.atoms.find((a) => a.id === b.atomId1);
            const a2 = prod.atoms.find((a) => a.id === b.atomId2);
            return a1 && a2 && a1.element === 'C' && a2.element === 'C';
        });
        if (dbl.length !== 1) return false;
        const cut = dbl[0];
        const adj = {};
        prod.atoms.forEach((a) => { adj[a.id] = []; });
        prod.bonds.forEach((b) => {
            if (b === cut) return;
            adj[b.atomId1].push(b.atomId2);
            adj[b.atomId2].push(b.atomId1);
        });
        const reach = (s) => {
            const seen = new Set([s]); const st = [s];
            while (st.length) { const x = st.pop(); adj[x].forEach((y) => { if (!seen.has(y)) { seen.add(y); st.push(y); } }); }
            return seen;
        };
        const s1 = reach(cut.atomId1);
        if (s1.has(cut.atomId2)) return false;   // 環状 ＝ 切っても1分子
        const s2 = reach(cut.atomId2);
        // 切った端に =O を付けて2つの断片を作る
        const build = (ids, capId) => {
            const sub = new Molecule(); const map = {};
            prod.atoms.forEach((a) => { if (ids.has(a.id)) map[a.id] = sub.addAtom(a.element, 0, 0).id; });
            prod.bonds.forEach((b) => { if (ids.has(b.atomId1) && ids.has(b.atomId2)) sub.addBond(map[b.atomId1], map[b.atomId2], b.type); });
            const o = sub.addAtom('O', 0, 0);
            sub.addBond(map[capId], o.id, 2);
            return sub;
        };
        const g1 = NW.groups(build(s1, cut.atomId1));
        const g2 = NW.groups(build(s2, cut.atomId2));
        const has = (g, t) => g.includes(t);
        return (has(g1, 'aldehyde') && has(g2, 'ketone')) || (has(g1, 'ketone') && has(g2, 'aldehyde'));
    },
    /** 脱水生成物が1種類のとき、その分子を作って返す（dehydOzoneAldKet の下請け） */
    _dehydOne(m) {
        let found = null;
        m.atoms.filter((a) => a.element === 'O').forEach((o) => {
            if (found) return;
            const on = m.getNeighbors(o.id);
            if (on.length !== 1 || on[0].type !== 1 || on[0].atom.element !== 'C') return;
            const alpha = on[0].atom;
            m.getNeighbors(alpha.id).forEach((nb) => {
                if (found || nb.atom.element !== 'C' || nb.type !== 1) return;
                const beta = nb.atom;
                if (m.getFreeValency(beta.id) < 1) return;
                const sub = new Molecule(); const map = {};
                m.atoms.forEach((a) => { if (a.id !== o.id) map[a.id] = sub.addAtom(a.element, a.x, a.y).id; });
                m.bonds.forEach((b) => {
                    if (b.atomId1 === o.id || b.atomId2 === o.id) return;
                    const isNew = (b.atomId1 === alpha.id && b.atomId2 === beta.id)
                        || (b.atomId2 === alpha.id && b.atomId1 === beta.id);
                    sub.addBond(map[b.atomId1], map[b.atomId2], isNew ? 2 : b.type);
                });
                found = sub;
            });
        });
        return found;
    },
    /**
     * α-アミノ酸か（M10・ニンヒドリン反応）。
     * **−NH₂ と −COOH が同じ炭素に付いている**こと。β-アミノ酸は呈色しないので分けられる。
     */
    alphaAmino(m) {
        if (m._nwAlpha !== undefined) return m._nwAlpha;
        m._nwAlpha = m.atoms.filter((a) => a.element === 'C').some((c) => {
            const nb = m.getNeighbors(c.id);
            // 隣に窒素（アミノ基。アミドの N は除く）
            const hasN = nb.some((x) => x.atom.element === 'N' && x.type === 1
                && !m.getNeighbors(x.atom.id).some((y) => y.atom.element === 'C'
                    && m.getNeighbors(y.atom.id).some((z) => z.atom.element === 'O' && z.type === 2)));
            if (!hasN) return false;
            // 隣にカルボキシ炭素（=O と −OH の両方をもつ C）
            return nb.some((x) => x.atom.element === 'C' && x.type === 1
                && m.getNeighbors(x.atom.id).some((y) => y.atom.element === 'O' && y.type === 2)
                && m.getNeighbors(x.atom.id).some((y) => y.atom.element === 'O' && y.type === 1
                    && m.getNeighbors(y.atom.id).length === 1));
        });
        return m._nwAlpha;
    },
    /** 環上で2種類の置換基が隣り合っているか（M9）。並べ方を知らないと判定できない */
    ringAdjSubs(m, kindA, kindB) {
        const pl = m._nwPlacement;
        if (!pl) return null;
        const i = ringSubIndex(m, kindA), j = ringSubIndex(m, kindB);
        if (i < 0 || j < 0) return null;
        return ringAdjacent(pl.pos[i], pl.pos[j], pl.ringSize);
    },
    /** 置換基を1つ H に換えたときの不斉炭素の数（M9）。−1 は判定できない */
    ringDropChiral(m, kind) {
        const i = ringSubIndex(m, kind);
        if (i < 0) return -1;
        const sub = ringDropSub(m, i);
        if (!sub) return -1;
        return sub.atoms.filter((a) => a.element === 'C' && sub.isAsymmetricCarbon(a.id)).length;
    },
    /** カルボニル（アルデヒド＋ケトン）の数。「還元すると二価のアルコール」＝ 2つ */
    carbonylCount(m) {
        if (m._nwCO === undefined) {
            m._nwCO = m.atoms.filter((a) => a.element === 'C'
                && m.getNeighbors(a.id).some((n) => n.atom.element === 'O' && n.type === 2)
                // カルボキシ基・エステルの C=O は「還元して二価アルコール」の話とは別なので数えない
                && !m.getNeighbors(a.id).some((n) => n.atom.element === 'O' && n.type === 1)).length;
        }
        return m._nwCO;
    },
    chiral(m) {
        if (m._nwChiral === undefined) m._nwChiral = m.atoms.filter((a) => a.element === 'C' && m.isAsymmetricCarbon(a.id)).length;
        return m._nwChiral;
    },
    /**
     * **同じ環境にあるメチル基**をまとめて、組の大きさを大きい順に返す（M11）。
     * 例: (CH3)3C−CH2−CHO は [3]、(CH3)2C(C2H5)−CHO は [2,1]、直鎖は [1]。
     *
     * 「等価なメチル基が3つ」は NMR の言い換えで、**問題文が対称性を直接くれる**型。
     * 判定は `rootedFragmentCode(m, id, null)` ＝ **その原子を先頭に固定した分子全体の
     * 正準コード**。2つの原子のコードが一致することが、構造として区別できないこと。
     * ⚠ 見ているのは平面の構造だけで、立体（不斉）は入らない。
     */
    equivMethyl(m) {
        if (m._nwEqMe) return m._nwEqMe;
        const groups = new Map();
        m.atoms.forEach((a) => {
            if (a.element !== 'C') return;
            const nb = m.getNeighbors(a.id).filter((n) => n.atom.element !== 'H');
            const hs = m.getFreeValency(a.id) + m.getNeighbors(a.id).filter((n) => n.atom.element === 'H').length;
            if (nb.length !== 1 || nb[0].type !== 1 || hs !== 3) return;   // 重原子1つと単結合・H が3つ
            const code = rootedFragmentCode(m, a.id, null);
            groups.set(code, (groups.get(code) || 0) + 1);
        });
        m._nwEqMe = [...groups.values()].sort((x, y) => y - x);
        return m._nwEqMe;
    },
    // ヨードホルム陽性 ＝ CH3-CO- または CH3-CH(OH)- を実際に探す。
    // ⚠ メタノールとホルムアルデヒドを陽性にしないこと（moves.json の注意書き）
    iodoform(m) {
        return m.atoms.some((a) => {
            if (a.element !== 'C' || m.getFreeValency(a.id) !== 3) return false;
            const nb = m.getNeighbors(a.id);
            if (nb.length !== 1) return false;
            const c = nb[0].atom;
            if (c.element !== 'C') return false;
            const isCarbonyl = m.getNeighbors(c.id).some((n) => n.atom.element === 'O' && n.type === 2);
            const isCarbinol = m.getFreeValency(c.id) >= 1
                && m.getNeighbors(c.id).some((n) => n.atom.element === 'O' && n.type === 1 && m.getFreeValency(n.atom.id) === 1);
            return isCarbonyl || isCarbinol;
        });
    },
    /**
     * オゾン分解（または過マンガン酸カリウムの酸化開裂）で**生成物が1種類**になるか。
     *
     * C=C を切って両側が同じなら1種類しか出ない ＝ **C=C をはさんで左右対称**。
     * 環状アルケンなら切っても分子が1つのままなので、これも1種類になる。
     * 九州大 2021 前期4 の決め手で、鎖状という条件と合わせると「対称」と言い切れる。
     *
     * ⚠ C=C が2つ以上あるときは false。切る場所が複数になり、この判定の前提が崩れる。
     */
    ozoneOne(m) {
        const dbl = m.bonds.filter((b) => {
            if (b.type !== 2) return false;
            const a1 = m.atoms.find((a) => a.id === b.atomId1);
            const a2 = m.atoms.find((a) => a.id === b.atomId2);
            return a1 && a2 && a1.element === 'C' && a2.element === 'C';
        });
        if (dbl.length !== 1) return false;
        const cut = dbl[0];
        // その結合を外した状態で連結成分を見る
        const adj = {};
        m.atoms.forEach((a) => { adj[a.id] = []; });
        m.bonds.forEach((b) => {
            if (b === cut) return;
            adj[b.atomId1].push(b.atomId2);
            adj[b.atomId2].push(b.atomId1);
        });
        const reach = (start) => {
            const seen = new Set([start]); const st = [start];
            while (st.length) { const x = st.pop(); adj[x].forEach((y) => { if (!seen.has(y)) { seen.add(y); st.push(y); } }); }
            return seen;
        };
        const side1 = reach(cut.atomId1);
        if (side1.has(cut.atomId2)) return true;   // 環状アルケン ＝ 切っても1分子
        const side2 = reach(cut.atomId2);
        const build = (ids) => {
            const sub = new Molecule();
            const map = {};
            m.atoms.forEach((a) => { if (ids.has(a.id)) map[a.id] = sub.addAtom(a.element, 0, 0).id; });
            m.bonds.forEach((b) => { if (ids.has(b.atomId1) && ids.has(b.atomId2)) sub.addBond(map[b.atomId1], map[b.atomId2], b.type); });
            return sub;
        };
        if (side1.size !== side2.size) return false;
        try { return canonicalCode(build(side1)) === canonicalCode(build(side2)); } catch (e) { return false; }
    },
    /** 候補の内訳ラベル。「どんな部品でできているか」でまとめる（設計書 §8 の配分カードにあたる） */
    partsLabel(m) {
        const g = NW.groups(m);
        const parts = [];
        if (NW.ring(m)) parts.push(`${NW.ring(m).length}員環`);
        if (g.includes('cc_double')) parts.push('C=C');
        // ⚠ **カルボキシ基とエステルを先に見る。** これを落とすと、カルボン酸が
        // 「飽和・官能基なし」と表示される（C5H10O2 を入れたときに実際にそうなった）。
        // エステル＋環はラクトンとしてまとめる（別の官能基が2つあるように見せない）
        if (g.includes('carboxyl')) parts.push('カルボキシ基');
        if (g.includes('ester')) parts.push(NW.ring(m) ? 'ラクトン' : 'エステル');
        if (g.includes('aldehyde')) parts.push('アルデヒド');
        if (g.includes('ketone')) parts.push('ケトン');
        if (g.includes('ether')) parts.push('エーテル');
        const alc = g.find((x) => x.startsWith('alcohol'));
        if (alc) parts.push({ alcohol1: '第一級 −OH', alcohol2: '第二級 −OH', alcohol3: '第三級 −OH' }[alc] || '−OH');
        return parts.join(' ＋ ') || '飽和・官能基なし';
    },
};

class NarrowingMode {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('narrowing-modal');
        if (!this.modal) return;
        this.formulaKey = 'C4H10O';
        // noEnol は**既定でオン**。列挙エンジンはエノール（C=C に −OH が直結した形）も作るが、
        // 高校化学では「ビニルアルコールは不安定ですぐアセトアルデヒドになる」と扱うので答えにならない。
        // 切れるようにしてあるのは、**なぜ除くのかを説明する材料になる**から（P14-M1b）
        this.constraints = { chiral: '', ring: '', noEnol: true };
        this.enolByProblem = false;
        // M2: 化合物ごとに1列。入試の構造決定は A〜F が並ぶのが普通で、
        // 1つの候補集合を絞る形では実物に合わない（設計書 §1・§4）
        this.columns = [{ name: 'A', stack: [] }];
        this.active = 0;
        // カードの一覧の絞り込み（発注書 §D）。**絞り込みの計算（test）とは無関係**で、
        // 一覧の見せ方だけを変える。積んだカードは絞り込んでも消えない（`#nw-stack` に残る）ので、
        // **一覧から消えたカードも「積んだ側の ×」で外せる**
        this.tag = '';            // いま押しているタグ（空 ＝ 全部）
        this.query = '';          // 部分一致の絞り込み（say の全要素と mean に当てる）
        this.pool = null;         // 制約をかけたあとの候補（Molecule の配列）。**全列で共有**
        this.baked = null;        // isomers-baked.json
        this.log = [];            // 操作ログ。op 単位で貯める（設計書 §10）

        // ⚠ **1つでも要素が欠けたらアプリ全体が起動しなくなる**構造にしないこと。
        // このクラスは game.js の起動列の途中で new されるので、ここで例外が飛ぶと
        // 後ろに並んでいる学習ビュー・書き出し練習まで初期化されない。
        // 実際、M5 のパネルを足したときに index.html だけ古いキャッシュが当たり、
        // `nw-allot-require` が null で TypeError → **アプリが起動しない**が2件出た。
        // 以後、要素の取得は必ずこの $ / on を通す。
        const $ = (id) => document.getElementById(id);
        const on = (id, ev, fn) => { const e = $(id); if (e) e.addEventListener(ev, fn); };

        const btn = $('btn-narrowing');
        if (btn) btn.addEventListener('click', () => this.open());
        on('btn-nw-close', 'click', () => this.modal.classList.add('hidden'));
        on('btn-nw-reset', 'click', () => { this.col().stack = []; this.record('op.card', 'reset'); this.render(); });
        on('btn-nw-log', 'click', () => this.dumpLog());
        // 部分一致の絞り込み（発注書 §D-4）。**実験の文と意味の両方に当てる** ——
        // 問題文を読んでいる人は「ヨウ素と水酸化ナトリウム」で、意味から入る人は「ヨードホルム」で探す
        on('nw-search', 'input', (e) => {
            this.query = e.target.value;
            this.record('op.filter', `q=${this.query}`);
            this.render();
        });
        on('btn-nw-filter-clear', 'click', () => {
            this.tag = ''; this.query = '';
            const s = $('nw-search');
            if (s) s.value = '';
            this.record('op.filter', 'clear');
            this.render();
        });
        on('btn-nw-add-col', 'click', () => this.addColumn());

        const sel = $('nw-formula');
        if (!sel) return;
        // ⚠ ヒントを option の文言に入れない。**select の幅は最長の option で決まる**ので、
        //    狭い画面でモーダルごと横に溢れる（実測 280px 幅で 369px になった）。別行に出す
        NARROW_FORMULAS.forEach((f) => {
            const o = document.createElement('option');
            o.value = f.key;
            o.textContent = f.label;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            this.formulaKey = sel.value;
            // 分子式が変われば全列の前提が変わる。**列は残して中身だけ空にする**
            // （A〜F という並びは問題文の側の話で、分子式とは独立）
            this.columns.forEach((c) => { c.stack = []; });
            this.pool = null;
            this.record('op.constraints', `formula=${sel.value}`);
            this.render();
        });
        ['nw-chiral', 'nw-ring'].forEach((id) => {
            on(id, 'change', (e) => {
                this.constraints[id === 'nw-chiral' ? 'chiral' : 'ring'] = e.target.value;
                this.pool = null;
                this.record('op.constraints', `${id}=${e.target.value}`);
                this.render();
            });
        });
        // M4: 入試問題の読み込み。データが無くてもモードは動く（自分で組む側は無傷）
        this.problems = null;
        this.loadProblems();
        on('nw-problem', 'change', (e) => this.pickProblem(e.target.value));
        // M5: 配分モード。列挙が届かない大きさをここで扱う
        const reqSel = $('nw-allot-require');
        if (reqSel) {
            ALLOT_PARTS.forEach((p) => {
                const o = document.createElement('option');
                o.value = p.name; o.textContent = p.name;
                reqSel.appendChild(o);
            });
        }
        ['nw-allot-formula', 'nw-allot-benzene', 'nw-allot-require'].forEach((id) => {
            on(id, 'input', () => this.renderAllot());
            on(id, 'change', () => this.renderAllot());
        });
        document.querySelectorAll('.nw-mode-tab').forEach((b) => {
            b.addEventListener('click', () => this.setPanel(b.dataset.panel));
        });
        // M6: 断片に割る
        this.fragKnown = [];
        const opSel = $('nw-frag-op');
        if (opSel) {
            Object.entries(FRAG_OPS).forEach(([k, v]) => {
                const o = document.createElement('option');
                o.value = k; o.textContent = v.label;
                opSel.appendChild(o);
            });
        }
        ['nw-frag-whole', 'nw-frag-op', 'nw-frag-valence'].forEach((id) => {
            on(id, 'input', () => this.renderFrag());
            on(id, 'change', () => this.renderFrag());
        });
        on('btn-nw-frag-add', 'click', () => {
            const f = $('nw-frag-add');
            const v = (f.value || '').trim();
            if (!v) return;
            this.fragKnown.push(v);
            f.value = '';
            this.record('op.split', '+' + v);
            this.renderFrag();
        });
        on('nw-frag-add', 'keydown', (e) => { if (e.key === 'Enter') $('btn-nw-frag-add').click(); });
        // M7: 元素分析から分子式へ
        ['nw-ea-sample', 'nw-ea-co2', 'nw-ea-h2o', 'nw-ea-mw', 'nw-ea-mmode',
         'nw-ea-gm', 'nw-ea-gv', 'nw-ea-gt', 'nw-ea-gp', 'nw-ea-mino'].forEach((id) => {
            on(id, 'input', () => this.renderEA());
            on(id, 'change', () => this.renderEA());
        });
        on('nw-enol', 'change', (e) => {
            this.constraints.noEnol = e.target.checked;
            this.enolByProblem = false;   // 生徒が自分で動かしたら、問題の指定ではなくなる
            this.pool = null;
            this.record('op.constraints', `noEnol=${e.target.checked}`);
            this.render();
        });
    }

    /** 列挙パネルと配分パネルの切り替え（M5）。制約の意味が違うので画面ごと分ける */
    setPanel(name) {
        this.panel = name;
        if (!document.getElementById('nw-panel-enum')) return;
        document.querySelectorAll('.nw-mode-tab').forEach((b) => b.classList.toggle('on', b.dataset.panel === name));
        document.getElementById('nw-panel-enum').classList.toggle('hidden', name !== 'enum');
        document.getElementById('nw-panel-allot').classList.toggle('hidden', name !== 'allot');
        const fp = document.getElementById('nw-panel-frag');
        if (fp) fp.classList.toggle('hidden', name !== 'frag');
        const ep = document.getElementById('nw-panel-ea');
        if (ep) ep.classList.toggle('hidden', name !== 'ea');
        this.record('op.panel', name);
        if (name === 'allot') this.renderAllot();
        if (name === 'frag') this.renderFrag();
        if (name === 'ea') this.renderEA();
    }

    open() {
        this.modal.classList.remove('hidden');
        if (!this.panel) this.setPanel('enum');
        // 画面を状態に合わせ直す。閉じている間に外から状態を変えられても食い違わないようにする
        document.getElementById('nw-formula').value = this.formulaKey;
        document.getElementById('nw-chiral').value = this.constraints.chiral;
        document.getElementById('nw-ring').value = this.constraints.ring;
        document.getElementById('nw-enol').checked = this.constraints.noEnol;
        const s = document.getElementById('nw-search');
        if (s) s.value = this.query;
        this.render();
    }

    /**
     * 入試問題のデータを読む（M4）。
     *
     * ⚠ このファイルに**問題文も解答の文章も入っていない**。入っているのは
     * 大学名・年・設問番号・分子式・実験の述語と、こちらで書いた見出しだけ
     * （`_解析/SCHEMA_問題DB.md` の著作権の扱いと同じ）。
     * 読めなくてもモードは動く（自分で組む側は無傷）ので、失敗しても黙って進む。
     */
    async loadProblems() {
        try {
            const res = await fetch('narrowing-problems.json', { cache: 'no-cache' });
            if (!res.ok) return;
            this.problems = (await res.json()).problems || [];
        } catch (e) { return; }
        const sel = document.getElementById('nw-problem');
        this.problems.forEach((p) => {
            const o = document.createElement('option');
            o.value = p.id;
            o.textContent = `${p.printed}（${p.year}）`;
            sel.appendChild(o);
        });
    }

    /** 選んだ入試問題を盤面に載せる。制約・分子式・列を一度に差し替える */
    pickProblem(id) {
        const src = document.getElementById('nw-source');
        if (!id || !this.problems) {
            src.classList.add('hidden');
            this.fragProblem = null;
            this.eaProblem = null;
            this.enolByProblem = false;
            this.record('op.problem', 'clear');
            this.render();
            return;
        }
        const p = this.problems.find((x) => x.id === id);
        if (!p) return;

        // 断片の仕様しか無い問題（列挙が届かない大きい分子）は、断片パネルへ送る。
        // ⚠ 列を作れないので、列挙側の初期化には進まない
        if (!p.columns.length && p.splits && p.splits.length) {
            this.fragProblem = p;
            this.eaProblem = p.ea ? p : null;
            this.fragKnown = [];
            const w = document.getElementById('nw-frag-whole');
            if (w) w.value = p.formula;
            const first = p.splits[0];
            const opEl = document.getElementById('nw-frag-op');
            const vEl = document.getElementById('nw-frag-valence');
            if (opEl) opEl.value = first.op || 'none';
            if (vEl && first.valence) vEl.value = String(first.valence);
            src.classList.remove('hidden');
            src.innerHTML = `<b>${esc(p.university)} ${p.year}年 ${esc(p.printed)}</b>`
                + `　${esc(p.formula)}　断片に割る手 ${p.splits.length}`
                + (p.solvable === false
                    ? '<span class="nw-collapsed">⚠ この問題は<b>出題ミスで最後まで絞れません</b>。断片に割るところまでが素材です。</span>'
                    : '')
                + (p.note ? `<span class="nw-collapsed">${esc(p.note)}</span>` : '');
            this.record('op.problem', id + ':frag');
            this.setPanel('frag');
            return;
        }
        // 列がある問題でも、**割り方があれば断片パネルに渡す**。
        // 学習院大3 3-1 が「列と割り方の両方を持つ」最初の問題で、ここを null にしていたため
        // 分子式を決める手（式量70 → C5H10）が断片パネルに出てこなかった。
        // 列挙と断片は排他ではない ＝ 分子式を決めてから絞り込む問題は、両方を順に使う
        this.fragProblem = (p.splits && p.splits.length) ? p : null;
        this.eaProblem = p.ea ? p : null;   // 元素分析の測定値（M7）。splits とは独立に持つ
        this.fragKnown = [];   // 前の問題の断片を持ち越さない
        this.formulaKey = p.formula;
        this.constraints = { ...p.constraints };
        // ⚠ **エノールを数えに入れる問題がある**（浜松医大 2021-3(2) の9種にはエノール2種が入る）。
        // 既定を外したときの警告は「数えすぎ」と言うので、**この問題ではその警告が嘘になる**。
        // 誰が外したのか（問題か生徒か）を覚えておく
        this.enolByProblem = p.constraints && p.constraints.noEnol === false;
        // **カードは積まずに列だけ用意する**。積んだ状態で渡すと答えを見せることになるので、
        // 実験は生徒が1枚ずつ置く。どの実験があるかは「この問題の実験」として別に出す
        this.columns = p.columns.map((c) => ({ name: c.name, stack: [], label: c.label, preset: c.stack, expect: c.expect }));
        this.active = 0;
        this.pool = null;
        document.getElementById('nw-formula').value = this.formulaKey;
        document.getElementById('nw-chiral').value = this.constraints.chiral;
        document.getElementById('nw-ring').value = this.constraints.ring;
        document.getElementById('nw-enol').checked = this.constraints.noEnol;
        src.classList.remove('hidden');
        src.innerHTML = `<b>${p.university} ${p.year}年 ${p.printed}</b>`
            + `　列 ${p.columns.length} 本（${p.columns.map((c) => c.name).join('・')}）`
            + (p.collapsed && p.collapsed.length
                ? `<span class="nw-collapsed">模範解答が1文で済ませている箇所が ${p.collapsed.length} か所あります: `
                  + p.collapsed.map((c) => c.note).join(' ／ ') + '</span>' : '');
        this.record('op.problem', id);
        this.render();
    }

    /**
     * 配分モード（M5）。**重原子9個以上は構造を列挙できない**ので、
     * 部品の割り振りだけで追う。芳香族はここでしか扱えない。
     *
     * 列挙モードと同じ画面に置くと制約の意味が食い違う（あちらは構造の集合、こちらは割り振りの集合）ので、
     * **別のパネルに分ける**。行き来はタブでする。
     */
    renderAllot() {
        const el = document.getElementById('nw-allot-out');
        const fEl = document.getElementById('nw-allot-formula');
        if (!el || !fEl) return;
        const f = fEl.value.trim();
        const benzene = document.getElementById('nw-allot-benzene').value;
        const req = document.getElementById('nw-allot-require').value;
        if (!f) { el.innerHTML = '<p class="nw-empty">分子式を入れてください（例: C12H14O2）。芳香族のように大きい分子でも一瞬で終わります。</p>'; return; }
        const r = allotUnsaturation(f, { benzene, require: req });
        if (r.error) { el.innerHTML = `<p class="nw-zero">${esc(r.error)}　分子式を確かめてください。</p>`; return; }
        this.record('op.allot', `${f}/benzene=${benzene}/require=${req}`);

        const esterMax = Math.floor(r.oxygen / 2);
        const tip = [];
        // ⚠ エステルの思考ルーチン（ユーザー指摘）。数え上げでは出ない ③④ を注意書きで補う
        if (req === 'エステル結合' || (r.oxygen >= 2 && r.rows.some((x) => x['エステル結合']))) {
            tip.push(`① 酸素が ${r.oxygen} 個 → エステルは<b>高々 ${esterMax} 価</b>（結合1つで酸素2個）`);
            if (r.dou > esterMax) tip.push('② 不飽和度が C=O のぶんより余っている → <b>環状エステル（ラクトン）を疑う</b>');
            if (esterMax >= 2) {
                tip.push('③ 2価以上 → <b>結合の向き</b>で3通りに分かれる（R−COO−R−COO−R ／ R−COO−R−OCO−R ／ R−OCO−R−COO−R）');
                tip.push('④ 2価以上 → 加水分解の生成物が <b>1:1 とはかぎらない</b>。同じアルコールが2分子出ることがある');
            }
        }

        const rows = r.rows.map((x) => Object.entries(x).map(([k, v]) => (v > 1 ? `${k}×${v}` : k)).join(' ＋ ') || '飽和・酸素なし');
        el.innerHTML = `<p class="nw-count">${esc(f)}　不飽和度 <b>${r.dou}</b>・酸素 <b>${r.oxygen}</b> 個`
            + `　→ 割り振り <b>${r.rows.length}</b> 通り</p>`
            + (rows.length ? `<ol class="nw-allot-list">${rows.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`
                : '<p class="nw-zero">条件を満たす割り振りがありません。</p>')
            + (tip.length ? `<div class="nw-ester"><b>エステルはこの順で考える</b><ol>${tip.map((t) => `<li>${t}</li>`).join('')}</ol></div>` : '');
    }

    /**
     * 断片に割るパネル（M6-1）。
     *
     * もとの分子式に割り方を選び、分かっている断片を積んでいくと**残りが引き算で出る**。
     * 残りが重原子8個以下なら、そのまま列挙パネルへ渡せる（M6-2）。
     *
     * ⚠ 列挙・配分と**制約の意味が違う**ので、ここも画面ごと分ける。
     *   列挙 … 構造の集合／配分 … 割り振りの集合／断片 … 分子式そのもの
     */
    renderFrag() {
        const el = document.getElementById('nw-frag-out');
        const wholeEl = document.getElementById('nw-frag-whole');
        if (!el || !wholeEl) return;
        const whole = wholeEl.value.trim();
        const op = document.getElementById('nw-frag-op').value;
        const valence = +document.getElementById('nw-frag-valence').value || 1;
        document.getElementById('nw-frag-valence').parentElement.classList.toggle('hidden', op !== 'hydrolysis');

        this.fragKnown = this.fragKnown || [];

        // 入試問題を読み込んでいるときは「この問題の割り方」を並べる。
        // ⚠ **押すまで積まない**（列挙側と同じ。積んだ状態で渡すと答えを見せることになる）
        const pre = document.getElementById('nw-frag-preset');
        if (pre) {
            const p = this.fragProblem;
            if (p && p.splits && p.splits.length) {
                pre.classList.remove('hidden');
                pre.innerHTML = `<span class="nw-preset-head">${esc(p.printed)} の割り方 ${p.splits.length} 手</span>`;
                p.splits.forEach((sp) => {
                    const b = document.createElement('button');
                    b.className = 'nw-pre';
                    b.textContent = sp.label;
                    b.title = `${(FRAG_OPS[sp.op] || FRAG_OPS.none).label}／引くもの: ${(sp.known || []).join('・') || 'なし'}`;
                    b.addEventListener('click', () => {
                        document.getElementById('nw-frag-whole').value = sp.whole || p.formula;
                        document.getElementById('nw-frag-op').value = sp.op || 'none';
                        if (sp.valence) document.getElementById('nw-frag-valence').value = String(sp.valence);
                        this.fragKnown = (sp.known || []).slice();
                        this.record('op.split', 'preset:' + sp.label);
                        this.renderFrag();
                    });
                    pre.appendChild(b);
                });
            } else pre.classList.add('hidden');
        }

        // 分かっている断片
        const list = document.getElementById('nw-frag-known');
        list.innerHTML = this.fragKnown.length ? '' : '<span class="nw-empty">分かっている断片を足してください</span>';
        this.fragKnown.forEach((k, i) => {
            const b = document.createElement('button');
            b.className = 'nw-pre on';
            b.textContent = `${k} ✕`;
            b.title = 'クリックで外す';
            b.addEventListener('click', () => { this.fragKnown.splice(i, 1); this.record('op.split', '-' + k); this.renderFrag(); });
            list.appendChild(b);
        });

        if (!whole) { el.innerHTML = '<p class="nw-empty">もとの分子式を入れてください（例: C13H16O4）。</p>'; return; }
        // ⚠ 扱えない元素を黙って捨てない。C2H5Cl を C2H5 として計算すると
        //    誤った断片が出るうえ、「重原子4個だから列挙できます」と案内してしまう
        const un = [...new Set([whole, ...this.fragKnown].flatMap(formulaUnknown))];
        if (un.length) {
            el.innerHTML = `<p class="nw-zero"><b>${esc(un.join('・'))} は扱えません。</b>`
                + 'このモードが数えられるのは C・H・O・N だけです（ハロゲンや硫黄を含む式は割れません）。</p>';
            return;
        }
        const w = parseFormula(whole);
        const wd = fragDou(w);
        if (!Number.isInteger(wd) || wd < 0) {
            el.innerHTML = `<p class="nw-zero">${esc(whole)} は不飽和度が整数になりません（${wd}）。分子式を確かめてください。</p>`;
            return;
        }
        const rest = fragmentRest(whole, this.fragKnown, op, valence);
        this.record('op.split', `${whole}/${op}/${this.fragKnown.join('+')}`);

        const head = `<p class="nw-count">${esc(whole)}　不飽和度 <b>${wd}</b>・重原子 <b>${fragHeavy(w)}</b></p>`;
        if (!rest) {
            el.innerHTML = head + '<p class="nw-zero"><b>引きすぎです。</b>足した断片の合計が、もとの分子式を超えています。</p>';
            return;
        }
        const h = fragHeavy(rest);
        const d = fragDou(rest);
        const canEnum = h <= 8 && h > 0;
        el.innerHTML = head
            + `<p class="nw-frag-rest">残り　<b>${esc(fragShow(rest))}</b>`
            + `<span>不飽和度 ${d}・重原子 ${h}</span></p>`
            + (h === 0 ? '<p class="nw-zero">残りがありません（ちょうど割り切れました）。</p>'
                : canEnum
                    ? '<p class="nw-frag-ok">重原子 ' + h + ' 個なので<b>列挙で追えます</b>。'
                      + '<button id="btn-nw-frag-go" class="view-btn">この断片を絞り込む</button></p>'
                    : `<p class="nw-frag-ng">重原子 ${h} 個は列挙が届きません（上限8）。<b>もう1回割ってください。</b></p>`);
        const go = document.getElementById('btn-nw-frag-go');
        if (go) go.addEventListener('click', () => this.sendToEnum(rest));
    }

    /**
     * 断片を列挙パネルへ渡す（M6-2）。
     * プリセットに無い分子式でも受けられるようにする（断片は C3H6O3 のような未登録の式になる）。
     */
    /**
     * 元素分析パネル（M7）。**測定値を扱う唯一のパネル**なので、
     * 途中の数字（各元素の質量 → 物質量 → 比）を全部出す。
     * 分子式だけ出しても、生徒は自分の答案と突き合わせられない。
     */
    renderEA() {
        const el = document.getElementById('nw-ea-out');
        if (!el) return;
        const num = (id) => parseFloat(String(document.getElementById(id).value).replace(/[^\d.eE+-]/g, ''));
        const mmode = document.getElementById('nw-ea-mmode').value;
        document.getElementById('nw-ea-mw-wrap').classList.toggle('hidden', mmode !== 'given' && mmode !== 'max');
        document.getElementById('nw-ea-gas-wrap').classList.toggle('hidden', mmode !== 'gas');

        let mw = null, mwNote = '';
        if (mmode === 'given') mw = num('nw-ea-mw');
        else if (mmode === 'max') mw = { max: num('nw-ea-mw') };
        else if (mmode === 'gas') {
            mw = eaMolarMassFromGas({
                mass: num('nw-ea-gm'), volumeL: num('nw-ea-gv'),
                tempC: num('nw-ea-gt'), pressurePa: num('nw-ea-gp'),
            });
            mwNote = mw === null ? '（気体の値が足りません）'
                : `　気体の状態方程式から <b>分子量 ${mw.toFixed(1)}</b>`;
        }

        const minO = +document.getElementById('nw-ea-mino').value || 0;
        const r = elementalAnalysis({
            sample: num('nw-ea-sample'), co2: num('nw-ea-co2'), h2o: num('nw-ea-h2o'),
            molarMass: mw, minO,
        });
        const rows = [];
        if (r.mass) {
            const f = (x) => (Math.abs(x) < 1e-9 ? '0' : x.toFixed(3));
            rows.push(`<div class="nw-frag-rest">C ${f(r.mass.C)}／H ${f(r.mass.H)}／O ${f(r.mass.O)}`
                + (r.noOxygen ? '　<b>酸素を含まない</b>' : '') + '</div>');
        }
        if (r.moles) {
            const g = (x) => x.toExponential(2);
            rows.push(`<div class="nw-collapsed">物質量 C ${g(r.moles.C)}／H ${g(r.moles.H)}／O ${g(r.moles.O)} mol</div>`);
        }
        if (r.ratio) {
            const show = Object.entries(r.ratio).filter(([, v]) => v).map(([k, v]) => k + (v > 1 ? v : '')).join('');
            rows.push(`<div class="nw-frag-rest">組成式 <b>${esc(show)}</b>（式量 ${r.unit}）</div>`);
        }
        if (mwNote) rows.push(`<div class="nw-collapsed">${mwNote}</div>`);
        // 窒素則。**分子量の偶奇だけで窒素の数の偶奇が決まる**ので、組成比とは別に出す
        if (r.nParity) {
            rows.push('<div class="nw-collapsed">窒素則: 分子量が'
                + (r.nParity === 'even' ? '偶数 → <b>窒素の数は偶数</b>（0個・2個…）'
                    : '奇数 → <b>窒素の数は奇数</b>（1個・3個…）')
                + '　※ハロゲンを含まないとき</div>');
        }
        if (r.formula) {
            const key = fragShow(r.formula);
            const heavy = fragHeavy(r.formula), dou = fragDou(r.formula);
            rows.push(`<div class="nw-frag-rest">分子式 <b>${esc(key)}</b>`
                + `（組成式の ${r.n} 倍）　不飽和度 ${dou}・重原子 ${heavy}</div>`);
            if (heavy <= 8) {
                rows.push('<button id="btn-nw-ea-go" class="view-btn">この分子式を絞り込む</button>');
            } else {
                rows.push(`<div class="nw-collapsed">重原子 ${heavy} 個なので構造は数え切れません。`
                    + '「部品を割り振る」か「断片に割る」へ進んでください。</div>');
            }
        }
        r.warn.forEach((w) => rows.push(`<div class="nw-collapsed">⚠ ${esc(w)}</div>`));
        el.innerHTML = rows.join('') || '<div class="nw-collapsed">値を入れてください</div>';
        const go = document.getElementById('btn-nw-ea-go');
        if (go) go.addEventListener('click', () => this.sendToEnum(r.formula));

        // 入試問題を読んでいるときは「この問題の測定値」を並べる。⚠ 押すまで入れない
        const pre = document.getElementById('nw-ea-preset');
        if (pre) {
            const p = this.eaProblem;
            const ea = p && p.ea;
            if (ea) {
                pre.classList.remove('hidden');
                pre.innerHTML = `<span class="nw-preset-head">${esc(p.printed)} の測定値</span>`;
                const b = document.createElement('button');
                b.className = 'nw-pre';
                b.textContent = ea.label || '元素分析の値を入れる';
                b.addEventListener('click', () => {
                    document.getElementById('nw-ea-sample').value = ea.sample;
                    document.getElementById('nw-ea-co2').value = ea.co2;
                    document.getElementById('nw-ea-h2o').value = ea.h2o;
                    document.getElementById('nw-ea-mmode').value = ea.mmode || 'given';
                    if (ea.mw !== undefined) document.getElementById('nw-ea-mw').value = ea.mw;
                    ['gm', 'gv', 'gt', 'gp'].forEach((k) => {
                        if (ea[k] !== undefined) document.getElementById('nw-ea-' + k).value = ea[k];
                    });
                    this.record('op.ea', 'preset:' + (ea.label || ''));
                    this.renderEA();
                });
                pre.appendChild(b);
            } else pre.classList.add('hidden');
        }
    }

    sendToEnum(rest) {
        const key = fragShow(rest);
        if (!NARROW_FORMULAS.some((f) => f.key === key)) {
            const el = [];
            ['C', 'O', 'N'].forEach((e) => { for (let i = 0; i < (rest[e] || 0); i++) el.push(e); });
            NARROW_FORMULAS.push({ key, label: key, elements: el, h: rest.H || 0, hint: '断片から渡された分子式', adhoc: true });
            const sel = document.getElementById('nw-formula');
            const o = document.createElement('option');
            o.value = key; o.textContent = key;
            sel.appendChild(o);
        }
        this.formulaKey = key;
        this.columns = [{ name: 'A', stack: [] }];
        this.active = 0;
        this.pool = null;
        document.getElementById('nw-formula').value = key;
        this.record('op.split', 'send:' + key);
        this.setPanel('enum');
        this.render();
    }

    col() { return this.columns[this.active] || this.columns[0]; }

    addColumn() {
        // A・B・C… と順に振る。26列を超えることは実問題では無い（最大でも A〜J 程度）
        const used = new Set(this.columns.map((c) => c.name));
        let name = 'A';
        for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.has(n)) { name = n; break; } }
        this.columns.push({ name, stack: [] });
        this.active = this.columns.length - 1;
        this.record('op.matrix', `+col:${name}`);
        this.render();
    }

    removeColumn(i) {
        if (this.columns.length <= 1) return;   // 列は最低1つ残す
        this.record('op.matrix', `-col:${this.columns[i].name}`);
        this.columns.splice(i, 1);
        if (this.active >= this.columns.length) this.active = this.columns.length - 1;
        this.render();
    }

    record(op, detail) {
        this.log.push({ t: Date.now(), op, detail, col: this.col().name, stack: this.col().stack.join('>') });
    }

    /** ログを JSON で出す。M1 では見るだけ。**診断が効くかは実データでしか確かめられない**ので最初から貯める */
    dumpLog() {
        const box = document.getElementById('nw-log-out');
        box.textContent = JSON.stringify(this.log, null, 1);
        box.classList.toggle('hidden', false);
    }

    formula() { return NARROW_FORMULAS.find((f) => f.key === this.formulaKey); }

    /** 焼いた JSON から Molecule を組み立て直す */
    fromBaked(rec) {
        const m = new Molecule();
        const ids = rec.e.split(',').map((el) => m.addAtom(el, 0, 0).id);
        rec.b.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
        return m;
    }

    /** 制約をかけた候補集合をつくる。制約は「候補集合の定義」で、カードとは別物（設計書 §2） */
    async buildPool() {
        if (this.pool) return this.pool;
        const f = this.formula();
        let list;
        // M9: 候補集合が**分子式の全異性体ではなく、環への置換基の並べ方**であるもの。
        // 関西大3 iii は重原子11個で列挙が届かないが、問題文が
        // 「シクロヘキサン環に −OH・イソプロピル・メチルが1つずつ」まで枠を絞ってくれている。
        // 枠の中だけ数えれば 6×5×4＝120 → 対称でまとめて10通りにしかならない
        if (f.ring) {
            list = ringPlacements(f.ring.size, f.ring.subs).map((x) => x.mol);
        } else if (f.baked) {
            if (!this.baked) {
                const res = await fetch(`isomers-baked.json?v=${window.APP_VERSION || ''}`, { cache: 'no-cache' });
                this.baked = (await res.json()).isomers;
            }
            list = (this.baked[f.key] || []).map((r) => this.fromBaked(r));
        } else {
            const r = enumerateConstitutionalIsomers(f.elements, f.h, 20000000);
            list = r.isomers;
        }
        this.all = list.length;
        // エノールを先に落とす。**他の制約より前にかける**のは、これが「そもそも候補に入らない」
        // 種類の除外だから（不斉炭素の数のような、問題文が言っている条件とは階層が違う）
        this.enolCount = list.filter((m) => NW.groups(m).includes('enol')).length;
        if (this.constraints.noEnol) list = list.filter((m) => !NW.groups(m).includes('enol'));
        if (this.constraints.chiral !== '') list = list.filter((m) => NW.chiral(m) === +this.constraints.chiral);
        if (this.constraints.ring === 'yes') list = list.filter((m) => !!NW.ring(m));
        if (this.constraints.ring === 'no') list = list.filter((m) => !NW.ring(m));
        this.pool = list;
        return list;
    }

    toggleCard(id) {
        const s = this.col().stack;
        const i = s.indexOf(id);
        if (i >= 0) s.splice(i, 1); else s.push(id);
        this.record('op.card', (i >= 0 ? '-' : '+') + id);
        this.render();
    }

    move(id, dir) {
        const s = this.col().stack;
        const i = s.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.length) return;
        [s[i], s[j]] = [s[j], s[i]];
        this.record('op.reorder', `${id}:${i}->${j}`);
        this.render();
    }

    /** その位置へ動かす（ドラッグ用）。動かなければ false を返す */
    moveTo(id, to) {
        const s = this.col().stack;
        const from = s.indexOf(id);
        if (from < 0 || to < 0 || to >= s.length || to === from) return false;
        s.splice(to, 0, s.splice(from, 1)[0]);
        this.record('op.reorder', `${id}:${from}->${to}`);
        return true;
    }

    /**
     * 積んだカードをドラッグで並べ替える（設計書 §4「カードはドラッグで並べ替え」）。
     *
     * ⚠ **ポインタの捕捉は行ではなく容器（#nw-stack）に取る。**
     * 動かすたびに再描画して候補数を引き直すので、行の DOM は毎回作り直される。
     * 行に捕捉していると、その行が消えた瞬間にドラッグが切れる。
     * 容器は再描画をまたいで生き残るので、ここに取れば最後まで続く。
     *
     * ⚠ 途中で**候補数が引き直されるのが見どころ**なので、離すまで待たずに動かした時点で反映する。
     * 「順番を変えると効きが変わる」を体で分からせるのがこのモードの本体（設計書 §1）。
     *
     * ↑↓ ボタンは残す。ドラッグできない場面（狭い画面・支援技術）でも並べ替えられるようにする。
     */
    beginDrag(e, id) {
        const stackEl = document.getElementById('nw-stack');
        if (!stackEl) return;
        e.preventDefault();
        this.dragId = id;
        try { stackEl.setPointerCapture(e.pointerId); } catch (err) { /* 捕捉できなくても動く */ }
        stackEl.classList.add('nw-dragging');

        const onMove = (ev) => {
            if (!this.dragId) return;
            const rows = [...stackEl.querySelectorAll('.nw-row')];
            // ポインタがどの行の上にあるか。行の**中線**をまたいだら入れ替える
            let to = -1;
            rows.forEach((r, i) => {
                const b = r.getBoundingClientRect();
                if (ev.clientY >= b.top && ev.clientY <= b.bottom) to = i;
            });
            if (to < 0) {
                // 一覧の外へ出たら、上端より上なら先頭、下端より下なら末尾へ寄せる
                const first = rows[0] && rows[0].getBoundingClientRect();
                const last = rows[rows.length - 1] && rows[rows.length - 1].getBoundingClientRect();
                if (first && ev.clientY < first.top) to = 0;
                else if (last && ev.clientY > last.bottom) to = rows.length - 1;
                else return;
            }
            if (this.moveTo(this.dragId, to)) this.render();
        };
        const onUp = () => {
            this.dragId = null;
            stackEl.classList.remove('nw-dragging');
            stackEl.removeEventListener('pointermove', onMove);
            stackEl.removeEventListener('pointerup', onUp);
            stackEl.removeEventListener('pointercancel', onUp);
            this.render();
        };
        stackEl.addEventListener('pointermove', onMove);
        stackEl.addEventListener('pointerup', onUp);
        stackEl.addEventListener('pointercancel', onUp);
    }

    /** ある列に積んだカードを順にかけたときの、各段の残り候補 */
    trace(stack, pool) {
        let cur = pool;
        const rows = stack.map((id) => {
            const card = NARROW_CARDS.find((c) => c.id === id);
            const before = cur.length;
            cur = cur.filter(card.test);
            return { id, before, after: cur.length, drop: before - cur.length };
        });
        return { rows, left: cur };
    }

    /**
     * ルート探索（M3・設計書 §6）。**積んだカードだけ**を対象にする。
     *
     * 条件は絞り込みなので**かける順番を変えても最後の候補集合は同じ**（フィルタは可換）。
     * 順番が効くのは途中の候補数だけ。だから2段に分けて調べる。
     *   1. どの部分集合で目標に届くか → 極小のものが「可能なルート」
     *   2. その集合をどの順でかけると速く減るか → 各段で最も減るものを選ぶ（貪欲）
     *
     * カードが n 枚なら 2ⁿ 通りの総当たり。実問題の実験は多くて8個なので実時間で終わる。
     * ⚠ **n が大きいと候補数の計算が n×2ⁿ 回走る**ので、上限を切って探索そのものを諦める
     * （「調べませんでした」と出すほうが、黙って固まるよりよい）。
     *
     * 試作は `_解析/tools/search-routes.js`。判定の名前と意味をそこから写している。
     */
    searchRoutes(stack, pool) {
        const n = stack.length;
        if (!n) return null;
        if (n > 12) return { tooMany: true, n };            // 2¹² = 4096 が実用上の上限
        const cards = stack.map((id) => NARROW_CARDS.find((c) => c.id === id));
        // 各カードが単独で残す集合を先に作る（同じ判定を何度も走らせない）
        const keep = cards.map((c) => pool.map((m) => c.test(m)));
        const countOf = (mask) => {
            let k = 0;
            for (let i = 0; i < pool.length; i++) {
                let ok = true;
                for (let b = 0; b < n; b++) if ((mask >> b) & 1) { if (!keep[b][i]) { ok = false; break; } }
                if (ok) k++;
            }
            return k;
        };
        const bits = (m) => { const r = []; for (let b = 0; b < n; b++) if ((m >> b) & 1) r.push(b); return r; };
        const FULL = (1 << n) - 1;
        const fullCount = countOf(FULL);
        // 目標は「1通り」ではなく **いま実際に到達している数**。
        // 1通りに届かない積み方（東大は実験だけでは3通りまでしか絞れない）でも
        // 「同じところへ、もっと少ない手で行けたか」は意味のある問いなので、それを見る。
        // こうすると minimal が空になることも無い（全部使えば必ず届く）
        const goal = fullCount;

        // 目標に届く部分集合のうち極小のもの（どれか1つ外すと届かなくなる）
        const reach = [];
        for (let mask = 0; mask <= FULL; mask++) if (countOf(mask) <= goal) reach.push(mask);
        const minimal = reach.filter((m) => bits(m).every((b) => countOf(m & ~(1 << b)) > goal));
        minimal.sort((a, b) => bits(a).length - bits(b).length);

        // かける順は貪欲（各段でいちばん減るものを選ぶ）
        const order = (mask) => {
            const rest = bits(mask);
            let cur = 0; let prev = pool.length;
            const steps = [];
            while (rest.length) {
                let best = null; let bestC = Infinity;
                rest.forEach((b) => { const k = countOf(cur | (1 << b)); if (k < bestC) { bestC = k; best = b; } });
                cur |= (1 << best);
                rest.splice(rest.indexOf(best), 1);
                steps.push({ id: cards[best].id, left: bestC, drop: prev - bestC });
                prev = bestC;
            }
            return steps;
        };

        // 同値な条件（残す集合がまったく同じ）。先に出たほうを代表にする
        const sig = keep.map((k) => k.map((v) => (v ? '1' : '0')).join(''));
        const dupOf = {};
        for (let b = 0; b < n; b++) for (let a = 0; a < b; a++) if (sig[a] === sig[b] && dupOf[b] === undefined) dupOf[b] = a;

        const used = new Set(minimal.flatMap(bits));
        const kind = (b) => {
            if (countOf(1 << b) === pool.length) return ['情報ゼロ', '単独でかけても1つも減らない。制約から自動的に満たされている'];
            if (dupOf[b] !== undefined) return ['重複', `「${cards[dupOf[b]].mean}」と残す集合が完全に同じ。どちらか一方でよい`];
            if (countOf(FULL & ~(1 << b)) === fullCount) return ['冗長', '他を全部使うなら、これを外しても結果が変わらない'];
            if (minimal.length && minimal.every((m) => (m >> b) & 1)) return ['必須', 'どのルートにも入る。外すと届かない'];
            if (used.has(b)) return ['代替あり', 'ルートによって使ったり使わなかったり'];
            return ['使わなくてよい', 'どの極小ルートにも入らない。あっても手数が増えるだけ'];
        };
        const ORDER = { 必須: 0, 代替あり: 1, 使わなくてよい: 2, 冗長: 3, 重複: 4, 情報ゼロ: 5 };
        const roles = cards.map((c, b) => ({ id: c.id, mean: c.mean, alone: countOf(1 << b), kind: kind(b) }))
            .sort((a, x) => ORDER[a.kind[0]] - ORDER[x.kind[0]] || a.alone - x.alone);

        return { n, fullCount, routes: minimal.map(order), roles };
    }

    async render() {
        const list = await this.buildPool();
        const cardById = Object.fromEntries(NARROW_CARDS.map((c) => [c.id, c]));

        // 全列ぶんを引き直す。**順番を変えると全部引き直される**のがこのモードの見どころ
        const traces = this.columns.map((c) => this.trace(c.stack, list));
        const { rows } = traces[this.active];
        const cur = traces[this.active].left;

        this.renderTabs(traces);
        this.renderMatrix(traces);

        document.getElementById('nw-hint').textContent = this.formula().hint;
        // エノールの除外は「制約」とひとまとめにせず、独立した段として見せる。
        // **なぜ候補から消えたのか**が分からないと、数が合わないときに自分の数え間違いを疑ってしまう
        const afterEnol = this.constraints.noEnol ? this.all - this.enolCount : this.all;
        const seg = [`${this.formula().label} の構造異性体 ${this.all} 通り`];
        if (this.constraints.noEnol && this.enolCount) seg.push(`エノール ${this.enolCount} 種を除いて ${afterEnol} 通り`);
        if (list.length !== afterEnol) seg.push(`制約で ${list.length} 通り`);
        document.getElementById('nw-start').textContent = seg.join(' → ');

        const warn = document.getElementById('nw-enol-note');
        // ⚠ **「数えすぎ」と言えるのは生徒が自分で外したときだけ。**
        // 問題のほうがエノールを数えに入れている場合（浜松医大 2021-3(2)）は、
        // 同じ文言が「あなたは間違えている」と読めてしまう。誰が外したかで言い分けを変える
        warn.textContent = this.constraints.noEnol || !this.enolCount ? ''
            : this.enolByProblem
                ? `この問題はエノール ${this.enolCount} 種も1種として数えます。`
                  + 'C=C に −OH が直結した形は単離できずすぐカルボニルに変わるので、'
                  + 'ふつうは答えの候補から外しますが、異性体の数を問う設問では数え上げの対象に入ることがあります'
                : `⚠ エノール ${this.enolCount} 種を候補に入れています。C=C に −OH が直結した形は単離できず、`
                  + 'すぐカルボニルに変わるので「化合物A」にはなれません。'
                  + '判定は正しく働きます（−OH をもつのでナトリウムとは反応します）が、答えの候補としては数えすぎになります';
        warn.classList.toggle('hidden', !warn.textContent);

        // 積んだカード（**いま選んでいる列のぶんだけ**）
        const stackEl = document.getElementById('nw-stack');
        stackEl.innerHTML = rows.length ? ''
            : `<p class="nw-empty">下のカードを押して <b>化合物 ${this.col().name}</b> に積んでください。`
              + '<b>積む順番で効きが変わります。</b>複数の化合物を追うときは「＋ 化合物」で列を足します。</p>';
        rows.forEach((r, i) => {
            const c = cardById[r.id];
            const div = document.createElement('div');
            div.className = 'nw-row' + (r.drop === 0 ? ' nw-dead' : '') + (this.dragId === r.id ? ' nw-held' : '');
            div.innerHTML = `<span class="nw-grip" title="つかんで上下に動かすと順番を変えられます">⠿</span>
                <span class="nw-n">${i + 1}</span>
                <span class="nw-say">${cardSay(c)}<em>＝ ${c.mean}</em></span>
                <span class="nw-drop">${r.drop === 0 ? '減らない' : '−' + r.drop}</span>
                <span class="nw-left">${r.after}</span>`;
            div.querySelector('.nw-grip').addEventListener('pointerdown', (e) => this.beginDrag(e, r.id));
            const ctrl = document.createElement('span');
            ctrl.className = 'nw-ctrl';
            [['↑', -1], ['↓', 1]].forEach(([t, d]) => {
                const b = document.createElement('button');
                b.textContent = t;
                b.addEventListener('click', () => this.move(r.id, d));
                ctrl.appendChild(b);
            });
            const x = document.createElement('button');
            x.textContent = '×';
            x.addEventListener('click', () => this.toggleCard(r.id));
            ctrl.appendChild(x);
            div.appendChild(ctrl);
            stackEl.appendChild(div);
        });

        // この列で実際に使われた実験（入試問題を読み込んだときだけ）。
        // **積んだ状態では渡さない**。積むのは生徒の仕事で、ここは「どの実験があるか」の一覧
        const pre = document.getElementById('nw-preset');
        const col = this.col();
        // ⚠ **カードを1枚も積まない列がある**（浜松医大 2021-3(2)・数え上げの設問）。
        // preset が空だとこの枠ごと消えて、**何をすればよいのか・いくつが正解かが画面から消える**。
        // 積むものが無いことを言うほうが親切なので、expect があれば見出しだけ出す
        if ((!col.preset || !col.preset.length) && col.expect !== undefined) {
            pre.classList.remove('hidden');
            pre.innerHTML = `<span class="nw-preset-head">${esc(col.label || col.name)}`
                + `　カードは要りません。制約だけそろえて数えます　→ ${col.expect} 通り</span>`;
        } else if (col.preset && col.preset.length) {
            pre.classList.remove('hidden');
            pre.innerHTML = `<span class="nw-preset-head">${esc(col.label || col.name)}　この列の実験 ${col.preset.length} 枚`
                + `${col.expect !== undefined ? `　→ 正しく積めば ${col.expect} 通り` : ''}</span>`;
            col.preset.forEach((id) => {
                const c = cardById[id];
                const b = document.createElement('button');
                b.className = 'nw-pre' + (col.stack.includes(id) ? ' on' : '');
                b.textContent = c.mean;
                b.title = cardSays(c).join(' ／ ');
                b.addEventListener('click', () => this.toggleCard(id));
                pre.appendChild(b);
            });
            const all = document.createElement('button');
            all.className = 'nw-pre nw-pre-all';
            all.textContent = col.stack.length === col.preset.length ? '↺ 外す' : '▶ 全部積む';
            all.addEventListener('click', () => {
                col.stack = col.stack.length === col.preset.length ? [] : col.preset.slice();
                this.record('op.problem', `fill:${col.name}`);
                this.render();
            });
            pre.appendChild(all);
        } else pre.classList.add('hidden');

        // 選べるカード
        this.renderPalette(cur);

        this.renderResult(cur, list);
    }

    /**
     * 選べるカードの一覧（発注書 ORDER_features_2026-08-15.md §D の 1・2・4）。
     *
     * **58枚を平らに並べると 1448px** ＝ モーダルの窓（968px）の1.5倍で、探せない。
     * カードは前から `row`（何を訊いているか）と `cell`（その答え）を持っているので、
     * **`row` でまとめて `cell` を横に並べれば 20行**になり、1画面に収まる。
     * データは1文字も変えていない（マトリクスが使っている `row`/`cell` をそのまま読む）。
     *
     * ⚠ **実験の文を画面から消してはいけない**（設計書 §5「カードの文言は実験の言い方にする」）。
     * ボタンには `title` と**読み上げ用の隠し文字**として実験文と意味を必ず持たせる。
     * 隠し文字は収録の台本（`#nw-palette button` + `contains` で文言から選ぶ）の受け口でもあり、
     * ここを落とすと**収録は成功したように見えて何も絞られていない動画**が焼ける。
     */
    renderPalette(cur) {
        const palette = document.getElementById('nw-palette');
        if (!palette) return;
        palette.innerHTML = '';
        this.renderTagBar(cur);

        const stack = this.col().stack;
        const shown = NARROW_CARDS.filter((c) => cardMatches(c, this.query, this.tag));
        if (!shown.length) {
            palette.innerHTML = '<p class="nw-empty">当てはまるカードがありません。'
                + '<b>実験の言い方（「ヨウ素と水酸化ナトリウム」）でも、意味（「ヨードホルム」）でも探せます。</b></p>';
            return;
        }
        NARROW_ROW_ORDER.forEach((row) => {
            const cards = shown.filter((c) => c.row === row);
            if (!cards.length) return;
            const g = document.createElement('div');
            g.className = 'nw-grp';
            g.dataset.row = row;
            const head = document.createElement('span');
            head.className = 'nw-grp-row';
            head.textContent = row;
            g.appendChild(head);
            const cells = document.createElement('div');
            cells.className = 'nw-grp-cells';
            cards.forEach((c) => {
                const b = document.createElement('button');
                b.className = 'nw-cell' + (stack.includes(c.id) ? ' on' : '');
                b.dataset.card = c.id;
                b.title = cardSays(c).join(' ／ ') + '　＝ ' + c.mean;
                // 見える文字は `cell` だけ。実験文と意味は**隠し文字**で必ず DOM に残す
                b.innerHTML = `${esc(c.cell)}<span class="nw-sr">${esc(cardSays(c).join(' ／ '))} ＝ ${esc(c.mean)}</span>`;
                b.addEventListener('click', () => this.toggleCard(c.id));
                cells.appendChild(b);
            });
            g.appendChild(cells);
            palette.appendChild(g);
        });
    }

    /**
     * タグの帯と、絞り込み中でも見える「残り N 通り」。
     *
     * ⚠ **カウンタを帯の中にも出す。** 一覧はモーダルのいちばん下にあるので、
     * カードを探しているあいだ `#nw-result` は画面の外に出ている
     * （V99 の収録手順がここで詰まり、400px スクロールして固定する回避策になっていた）。
     * 帯を貼り付け（sticky）にして残り候補を添えると、**探しながら数を見られる**。
     */
    renderTagBar(cur) {
        const bar = document.getElementById('nw-tagbar');
        if (!bar) return;
        bar.innerHTML = '';
        NARROW_TAGS.forEach((t) => {
            const n = NARROW_CARDS.filter((c) => (c.tags || []).includes(t)).length;
            const b = document.createElement('button');
            b.className = 'nw-tagbtn' + (this.tag === t ? ' on' : '');
            b.textContent = t;
            b.title = `${t} のカード ${n} 枚だけにする（もう一度押すと全部に戻ります）`;
            b.addEventListener('click', () => {
                this.tag = this.tag === t ? '' : t;
                this.record('op.filter', `tag=${this.tag}`);
                this.render();
            });
            bar.appendChild(b);
        });
        const all = document.createElement('button');
        all.className = 'nw-tagbtn nw-tagbtn-all' + (this.tag ? '' : ' on');
        all.textContent = `すべて（${NARROW_CARDS.length}）`;
        all.title = 'タグの絞り込みをやめて、全部のカードを出します';
        all.addEventListener('click', () => { this.tag = ''; this.record('op.filter', 'tag='); this.render(); });
        bar.appendChild(all);

        const cnt = document.getElementById('nw-filter-count');
        if (cnt) cnt.innerHTML = `化合物 ${esc(this.col().name)} の残り <b>${cur.length}</b> 通り`;
    }

    /** 列（化合物）のタブ。いま何を追っているかと、各列の残り候補数を出す */
    renderTabs(traces) {
        const el = document.getElementById('nw-tabs');
        el.innerHTML = '';
        this.columns.forEach((c, i) => {
            const n = traces[i].left.length;
            const b = document.createElement('button');
            b.className = 'nw-tab' + (i === this.active ? ' on' : '') + (n === 1 ? ' done' : '') + (n === 0 ? ' zero' : '');
            b.innerHTML = `${c.name}<em>${n}</em>`;
            b.title = n === 1 ? `${c.name} は1通りに決まりました` : `${c.name} の残り候補 ${n} 通り`;
            b.addEventListener('click', () => { this.active = i; this.record('op.matrix', `col:${c.name}`); this.render(); });
            el.appendChild(b);
            if (this.columns.length > 1) {
                const x = document.createElement('button');
                x.className = 'nw-tab-x';
                x.textContent = '×';
                x.title = `化合物 ${c.name} の列を消す`;
                x.addEventListener('click', () => this.removeColumn(i));
                el.appendChild(x);
            }
        });
    }

    /**
     * マトリクス（設計書 §4）。行が性質、列が化合物。
     *
     * **空のセルが「まだ決まっていないこと」を示す**のがこの表の値打ちで、
     * どこを埋めれば進むかが見える。線形にたどるより取りこぼしが減る。
     * 紙の答案（東大 2021 前期1I）が実際に作っていた表そのもの。
     */
    renderMatrix(traces) {
        const el = document.getElementById('nw-matrix');
        const used = NARROW_ROWS.filter((r) => this.columns.some((c) => c.stack.some((id) => NARROW_CARDS.find((x) => x.id === id).row === r)));
        // 1列だけで、まだ何も積んでいないうちは表を出さない（空の表は情報がゼロ）
        if (!used.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
        el.classList.remove('hidden');

        // セルの値。**同じ行に後から積んだカードが勝つ**（積み直しで上書きできる）
        const cellOf = (col, row) => {
            let v = '';
            col.stack.forEach((id) => { const c = NARROW_CARDS.find((x) => x.id === id); if (c.row === row) v = c.cell; });
            return v;
        };
        const th = (s, cls) => `<th${cls ? ` class="${cls}"` : ''}>${s}</th>`;
        const head = '<tr>' + th('') + this.columns.map((c, i) =>
            th(c.name, i === this.active ? 'on' : '')).join('') + '</tr>';
        const body = used.map((r) => '<tr>' + th(r, 'rowhead') + this.columns.map((c) => {
            const v = cellOf(c, r);
            return `<td class="${v ? 'set' : 'blank'}">${v || '・'}</td>`;
        }).join('') + '</tr>').join('');
        const foot = '<tr class="nw-foot">' + th('残り候補', 'rowhead') + traces.map((t) =>
            `<td class="${t.left.length === 1 ? 'one' : t.left.length === 0 ? 'zero' : ''}">${t.left.length}</td>`).join('') + '</tr>';
        el.innerHTML = `<table>${head}${body}${foot}</table>`
            + '<p class="nw-matrix-note">「・」はまだ決まっていない欄。<b>そこを埋める実験を探すのが次の一手。</b></p>';
    }

    /** 候補の見せ方は3段階（設計書 §8）。M1 は「数と内訳」まで。1通りのときだけ描く */
    renderResult(cur, pool) {
        const out = document.getElementById('nw-result');
        const svg = document.getElementById('nw-svg');
        svg.classList.add('hidden');

        // ルート探索は**2枚以上積んだら常に出す**。1通りに届いていなくても
        // 「同じところへもっと少ない手で行けたか」は意味のある問い（設計書 §6）
        if (this.col().stack.length >= 2 && cur.length > 0) this.renderRoutes(pool);
        else document.getElementById('nw-routes').classList.add('hidden');

        if (cur.length === 0) {
            out.innerHTML = '<p class="nw-zero"><b>候補が 0 になりました。</b>両立しない条件を積んでいます（「−OH をもつ」と「もたない」など）。</p>';
            return;
        }
        if (cur.length === 1) {
            out.innerHTML = '<p class="nw-one"><b>1通りに決まりました。</b></p>';
            svg.classList.remove('hidden');
            const m = cur[0];
            layoutMolecule(m);
            const idx = Object.fromEntries(m.atoms.map((a, i) => [a.id, i]));
            renderMoleculeIntoSvg(this.game, 'nw-svg', {
                atoms: m.atoms.map((a) => ({ element: a.element, x: a.x, y: a.y })),
                bonds: m.bonds.map((b) => ({ atom1Index: idx[b.atomId1], atom2Index: idx[b.atomId2], type: b.type })),
            }, false);
            this.record('op.solved', this.col().stack.join('>'));
            return;
        }
        // 内訳。同じ部品構成のものをまとめて数える
        const by = {};
        cur.forEach((m) => { const k = NW.partsLabel(m); by[k] = (by[k] || 0) + 1; });
        const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
        out.innerHTML = `<p class="nw-count">残り <b>${cur.length}</b> 通り</p>`
            + '<ul class="nw-parts">' + rows.map(([k, n]) => `<li><span>${k}</span><b>${n}</b></li>`).join('') + '</ul>';
    }

    /**
     * ルート探索の結果（M3）。1通りに決まったときだけ出す。
     *
     * ⚠ **「冗長」はこの化合物を決めるだけなら、の意味**（設計書 §6）。
     * 同じ実験が他の化合物には必須のことがあるので、この但し書きを画面から落とさない。
     */
    renderRoutes(pool) {
        const el = document.getElementById('nw-routes');
        const r = this.searchRoutes(this.col().stack, pool);
        el.classList.remove('hidden');
        if (!r) { el.classList.add('hidden'); return; }
        if (r.tooMany) {
            el.innerHTML = `<p class="nw-routes-head">カードが ${r.n} 枚あるので、他の解き方は調べませんでした（総当たりが重すぎます）。</p>`;
            return;
        }
        const meanOf = (id) => (NARROW_CARDS.find((c) => c.id === id) || {}).mean || id;
        const mine = this.col().stack.length;
        const best = r.routes.length ? r.routes[0].length : mine;
        const goal = r.fullCount === 1 ? '1通り' : `${r.fullCount} 通り`;

        const head = r.routes.length > 1
            ? `<p class="nw-routes-head"><b>他にも解き方があります。</b>${goal}に届く最小の組み合わせが <b>${r.routes.length} 通り</b>ありました`
              + `（いま積んでいるのは ${mine} 手、最短は <b>${best} 手</b>）。</p>`
            : `<p class="nw-routes-head">${goal}に届く最小の組み合わせは<b>1つだけ</b>でした`
              + `（いま ${mine} 手、最短 <b>${best} 手</b>）。この筋以外に道はありません。</p>`;

        const routes = r.routes.slice(0, 4).map((steps, i) => {
            const li = steps.map((s) => `<li><span>${meanOf(s.id)}</span><b>${s.left}</b><em>−${s.drop}</em></li>`).join('');
            return `<div class="nw-route"><h4>ルート${i + 1}（${steps.length} 手）${steps.length === best ? '<i>最短</i>' : ''}</h4><ol>${li}</ol></div>`;
        }).join('');
        const more = r.routes.length > 4 ? `<p class="nw-routes-more">…ほか ${r.routes.length - 4} 通り</p>` : '';

        const roles = r.roles.map((x) =>
            `<li class="k-${x.kind[0]}"><span>${x.mean}</span><b>${x.kind[0]}</b><em title="${x.kind[1]}">単独で ${x.alone} 通り</em></li>`).join('');

        el.innerHTML = head
            + `<div class="nw-routes-list">${routes}</div>${more}`
            + '<h4 class="nw-roles-head">積んだカードの性質</h4>'
            + `<ul class="nw-roles">${roles}</ul>`
            + '<p class="nw-routes-note">⚠「冗長」は<b>この化合物を決めるだけなら</b>の意味。'
            + '同じ実験が他の化合物には必須のことがあります。</p>';
    }
}

if (typeof window !== 'undefined') {
    window.NarrowingMode = NarrowingMode;
    window.NARROW_CARDS = NARROW_CARDS;
    window.NARROW_FORMULAS = NARROW_FORMULAS;
    window.NARROW_ROWS = NARROW_ROWS;
    // タグと一覧のまとめ方（発注書 §D）。const は window に載らないので明示的に公開する
    window.NARROW_TAGS = NARROW_TAGS;
    window.NARROW_ROW_TAGS = NARROW_ROW_TAGS;
    window.NARROW_ROW_ORDER = NARROW_ROW_ORDER;
    window.cardSays = cardSays;
    window.cardSay = cardSay;
    window.cardMatches = cardMatches;
    window.NW = NW;
    window.allotUnsaturation = allotUnsaturation;
    window.ALLOT_PARTS = ALLOT_PARTS;
    // 断片に割る（M6）。const は window に載らないので明示的に公開する
    window.fragmentRest = fragmentRest;
    window.fragmentCompositions = fragmentCompositions;
    window.fragShow = fragShow;
    window.formulaUnknown = formulaUnknown;
    window.fragHeavy = fragHeavy;
    window.fragDou = fragDou;
    window.FRAG_OPS = FRAG_OPS;
    window.FRAG_GROUPS = FRAG_GROUPS;
    // 元素分析から分子式へ（M7）
    window.elementalAnalysis = elementalAnalysis;
    window.eaMasses = eaMasses;
    window.eaSimplestRatio = eaSimplestRatio;
    window.eaMolarMassFromGas = eaMolarMassFromGas;
    window.eaCandidateN = eaCandidateN;
    window.eaNitrogenParity = eaNitrogenParity;
    // 環に置換基を並べる（M9）
    window.ringPlacements = ringPlacements;
    window.ringAdjacent = ringAdjacent;
    window.ringDropSub = ringDropSub;
    window.ringSubIndex = ringSubIndex;
    window.RING_SUBS = RING_SUBS;
}
