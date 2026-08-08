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
    { id: 'na', say: 'ナトリウムを加えると水素が発生した', mean: '−OH をもつ', row: '−OH', cell: '○', test: (m) => NW.hydroxy(m) },
    { id: 'na-no', say: 'ナトリウムを加えても変化がなかった', mean: '−OH をもたない', row: '−OH', cell: '×', test: (m) => !NW.hydroxy(m) },
    { id: 'ox1', say: '酸化するとアルデヒドが得られた', mean: '第一級アルコール', row: 'アルコールの級', cell: '1級', test: (m) => NW.groups(m).includes('alcohol1') },
    { id: 'ox2', say: '酸化するとケトンが得られた', mean: '第二級アルコール', row: 'アルコールの級', cell: '2級', test: (m) => NW.groups(m).includes('alcohol2') },
    { id: 'ox3', say: '酸化されなかった', mean: '第三級アルコール', row: 'アルコールの級', cell: '3級', test: (m) => NW.groups(m).includes('alcohol3') },
    { id: 'iodo', say: 'ヨウ素と水酸化ナトリウムで黄色の沈殿が生じた', mean: 'ヨードホルム陽性（CH3-CO- か CH3-CH(OH)-）', row: 'ヨードホルム', cell: '○', test: (m) => NW.iodoform(m) },
    { id: 'iodo-no', say: 'ヨウ素と水酸化ナトリウムでは沈殿しなかった', mean: 'ヨードホルム陰性', row: 'ヨードホルム', cell: '×', test: (m) => !NW.iodoform(m) },
    { id: 'silver', say: '銀鏡反応を示した', mean: 'アルデヒド', row: 'アルデヒド', cell: '○', test: (m) => NW.groups(m).includes('aldehyde') },
    { id: 'silver-no', say: '銀鏡反応を示さなかった', mean: 'アルデヒドでない', row: 'アルデヒド', cell: '×', test: (m) => !NW.groups(m).includes('aldehyde') },
    { id: 'br2', say: '臭素水を脱色した', mean: '炭素間二重結合をもつ', row: 'C=C', cell: '○', test: (m) => NW.groups(m).includes('cc_double') },
    { id: 'br2-no', say: '臭素水を脱色しなかった', mean: '炭素間二重結合をもたない', row: 'C=C', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') },
    { id: 'h2-no', say: '水素を付加しなかった', mean: '不飽和結合をもたない（＝不飽和度は環のぶん）', row: '不飽和結合', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') && !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    { id: 'ether', say: '加水分解されず、ナトリウムとも反応しなかった', mean: 'エーテル', row: 'エーテル', cell: '○', test: (m) => NW.groups(m).includes('ether') },
    { id: 'carbonyl-no', say: '赤外吸収でカルボニル基が見られなかった', mean: 'C=O をもたない', row: 'C=O', cell: '×', test: (m) => !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    // 光学異性体。**制約パネルの「不斉炭素がちょうど n 個」とは別物**。
    // 問題文の前提（東大「いずれも不斉炭素原子を一つだけもっている」）は制約だが、
    // 実験として「A・F・G には光学異性体が存在した」と言われたらこちらのカードになる（東京都立大2）
    { id: 'optical', say: '光学異性体が存在した', mean: '不斉炭素をもつ', row: '光学異性体', cell: '○', test: (m) => NW.chiral(m) >= 1 },
    { id: 'optical-no', say: '光学異性体は存在しなかった', mean: '不斉炭素をもたない', row: '光学異性体', cell: '×', test: (m) => NW.chiral(m) === 0 },
    // 環の有無も**カード**。制約パネルにも同じ項目があるが、あちらは問題文の前提用。
    // 「水素を付加しないのに不飽和度が1ある → 環をもつ」は実験からの結論なので、こちら
    { id: 'ring-yes', say: '環をもつことがわかった', mean: '環をもつ', row: '環', cell: '○', test: (m) => !!NW.ring(m) },
    { id: 'ring-no', say: '環をもたないことがわかった', mean: '環をもたない', row: '環', cell: '×', test: (m) => !NW.ring(m) },
    // オゾン分解（や過マンガン酸カリウムの酸化開裂）で生成物が1種類 ＝ C=C をはさんで左右対称。
    // 九州大 2021 前期4 の決め手。鎖状と分かっていれば「対称」と言い切れる
    { id: 'ozone-one', say: 'オゾン分解すると1種類の化合物だけが得られた', mean: 'C=C をはさんで左右対称', row: 'オゾン分解', cell: '1種類', test: (m) => NW.ozoneOne(m) },
    { id: 'ozone-two', say: 'オゾン分解すると2種類の化合物が得られた', mean: 'C=C の左右が違う', row: 'オゾン分解', cell: '2種類', test: (m) => NW.groups(m).includes('cc_double') && !NW.ozoneOne(m) },
    // カルボン酸とエステル。**判定は chemistry.js に前からあった**（carboxyl / ester）が、
    // カードが無いので言えなかった。C4H8O2 のプリセットは「エステルとカルボン酸が混ざる」と
    // 謳っているのに、その2つを分ける手が無い状態だった（熊本大 前3 を入れようとして気づいた）
    { id: 'acid', say: '水溶液が酸性を示し、炭酸水素ナトリウムで気体が発生した', mean: 'カルボキシ基をもつ', row: '酸・エステル', cell: '酸', test: (m) => NW.groups(m).includes('carboxyl') },
    { id: 'acid-no', say: '水溶液は中性だった', mean: 'カルボキシ基をもたない', row: '酸・エステル', cell: '酸でない', test: (m) => !NW.groups(m).includes('carboxyl') },
    { id: 'ester', say: '加水分解するとカルボン酸とアルコールが得られた', mean: 'エステル結合をもつ', row: '酸・エステル', cell: 'エステル', test: (m) => NW.groups(m).includes('ester') },
    // 環状エステル（ラクトン）。加水分解しても分子の数が増えず、−OH と −COOH が同じ分子から出る。
    // エステルの思考ルーチンの②（不飽和度が余ったらラクトンを疑う）がこれ
    { id: 'lactone', say: '加水分解すると1種類の化合物だけになり、−OH と −COOH をもっていた', mean: '環状エステル（ラクトン）', row: '酸・エステル', cell: 'ラクトン', test: (m) => NW.groups(m).includes('ester') && !!NW.ring(m) },
    // カルボニルの数。二価アルデヒド（熊本大 前3 の A）のように「2つもつ」が決め手になる
    { id: 'carbonyl2', say: '還元すると二価のアルコールが得られた', mean: 'カルボニルを2つもつ', row: 'C=O', cell: '2つ', test: (m) => NW.carbonylCount(m) === 2 },
    { id: 'ketone-no', say: '還元すると第一級アルコールだけが得られた', mean: 'ケトンをもたない', row: 'C=O', cell: 'ケトン×', test: (m) => !NW.groups(m).includes('ketone') },
    // 「直鎖状の〜が得られた」型。**枝分かれを消すのはこれ**で、環の有無とは別の条件。
    // 熊本大 前3 の A は「還元すると直鎖状の二価の第一級アルコール」で、
    // これが無いと 2-メチルプロパンジアールが残る（実測 4 → 1）
    { id: 'straight', say: '直鎖状の化合物が得られた', mean: '炭素骨格が枝分かれしていない', row: '骨格', cell: '直鎖', test: (m) => NW.straightChain(m) },
    { id: 'branched', say: '枝分かれのある化合物が得られた', mean: '炭素骨格が枝分かれしている', row: '骨格', cell: '枝分かれ', test: (m) => !NW.straightChain(m) && !NW.ring(m) },
    // 臭素を付加してできるジブロモ体の不斉炭素の数。**元の分子ではなく付加後で数える**。
    // 熊本大 前3 の B・C の決め手（クロトン酸に Br2 を付けると不斉炭素が2つできる）
    { id: 'dibromo2', say: '臭素を付加すると不斉炭素原子を2つもつジブロモ体になった', mean: 'ジブロモ体の不斉炭素が2つ', row: '付加物', cell: 'Br2で不斉2', test: (m) => NW.dibromoChiral(m) === 2 },
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
        id: `ring${n}`, say: `${RING_KANJI[n]}員環をもつ`, mean: `${n}員環`,
        row: '環の大きさ', cell: `${n}員`,
        test: (m) => { const c = NW.ring(m); return !!c && c.length === n; },
    });
}
// 表の行の並び。カードに出てこない行は出さない
const NARROW_ROWS = ['−OH', 'アルコールの級', 'C=O', 'アルデヒド', 'C=C', '不飽和結合', 'エーテル', 'ヨードホルム', '光学異性体', '環', '環の大きさ', 'オゾン分解', '酸・エステル', '骨格', '付加物'];

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

function parseFormula(f) {
    const m = { C: 0, H: 0, O: 0, N: 0 };
    const re = /([A-Z][a-z]?)(\d*)/g;
    let g;
    while ((g = re.exec(f))) { if (g[1] && m[g[1]] !== undefined) m[g[1]] += (g[2] ? +g[2] : 1); }
    return m;
}

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
        // M2: 化合物ごとに1列。入試の構造決定は A〜F が並ぶのが普通で、
        // 1つの候補集合を絞る形では実物に合わない（設計書 §1・§4）
        this.columns = [{ name: 'A', stack: [] }];
        this.active = 0;
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
        on('nw-enol', 'change', (e) => {
            this.constraints.noEnol = e.target.checked;
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
        this.record('op.panel', name);
        if (name === 'allot') this.renderAllot();
    }

    open() {
        this.modal.classList.remove('hidden');
        if (!this.panel) this.setPanel('enum');
        // 画面を状態に合わせ直す。閉じている間に外から状態を変えられても食い違わないようにする
        document.getElementById('nw-formula').value = this.formulaKey;
        document.getElementById('nw-chiral').value = this.constraints.chiral;
        document.getElementById('nw-ring').value = this.constraints.ring;
        document.getElementById('nw-enol').checked = this.constraints.noEnol;
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
            this.record('op.problem', 'clear');
            this.render();
            return;
        }
        const p = this.problems.find((x) => x.id === id);
        if (!p) return;
        this.formulaKey = p.formula;
        this.constraints = { ...p.constraints };
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
        if (f.baked) {
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
        warn.textContent = !this.constraints.noEnol && this.enolCount
            ? `⚠ エノール ${this.enolCount} 種を候補に入れています。C=C に −OH が直結した形は単離できず、`
              + 'すぐカルボニルに変わるので「化合物A」にはなれません。'
              + '判定は正しく働きます（−OH をもつのでナトリウムとは反応します）が、答えの候補としては数えすぎになります'
            : '';
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
                <span class="nw-say">${c.say}<em>＝ ${c.mean}</em></span>
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
        if (col.preset && col.preset.length) {
            pre.classList.remove('hidden');
            pre.innerHTML = `<span class="nw-preset-head">${esc(col.label || col.name)}　この列の実験 ${col.preset.length} 枚`
                + `${col.expect !== undefined ? `　→ 正しく積めば ${col.expect} 通り` : ''}</span>`;
            col.preset.forEach((id) => {
                const c = cardById[id];
                const b = document.createElement('button');
                b.className = 'nw-pre' + (col.stack.includes(id) ? ' on' : '');
                b.textContent = c.mean;
                b.title = c.say;
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
        const palette = document.getElementById('nw-palette');
        palette.innerHTML = '';
        NARROW_CARDS.forEach((c) => {
            const b = document.createElement('button');
            b.className = 'nw-card' + (this.col().stack.includes(c.id) ? ' on' : '');
            b.innerHTML = `${c.say}<em>＝ ${c.mean}</em>`;
            b.addEventListener('click', () => this.toggleCard(c.id));
            palette.appendChild(b);
        });

        this.renderResult(cur, list);
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
    window.NW = NW;
    window.allotUnsaturation = allotUnsaturation;
    window.ALLOT_PARTS = ALLOT_PARTS;
}
