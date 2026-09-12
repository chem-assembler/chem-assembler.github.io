// 色でみる無機化学 — アキネーターの**デッキ**「無機・第1段（沈殿 21 ＋ イオン 9 ＝ 30件）」
//
// ★★ **デッキは差し替えられる**（2026-09-12・ユーザー決定）。
//   模型（akinator-model.js）はここに何が入るかを知らない。
//   ⇒ 「化学基礎限定」「有機 223件」を作るときは、**このファイルと同じ形のファイルを1枚足すだけ**。
//      ページも模型も触らない（`akinator.html?deck=<id>` で開く）。
//
// 【★ 材料 —— 新しく調べたマスはほぼゼロ】（設計書 §4-5 の第1段B）
//   ・沈殿 21件 … `muki/chemistry.js` の `PRECIPITATES`（**19件**）
//                 ＋ `muki/separation-model.js` の `SEP_TABLE` が沈殿として名指ししている
//                   `Al(OH)₃`・`FeO(OH)` の 2件 ＝ 21件
//   ・イオン 9件 … `muki/separation-model.js` の `SEP_IONS`（実装済み）
//   ・炎色反応 … `SEP_IONS.flame`（Cu 青緑・Ca 橙赤・Na 黄・K 赤紫）
//   ・試薬の反応 … `SEP_TABLE`（希塩酸・硫化水素・アンモニア水・水酸化ナトリウム）
//   ⚠ **新しく足した事実は1つだけ**: **バリウムの炎色 ＝ 黄緑色**。
//     ★ 炎色で色が出る7元素（Li・Na・K・Ca・Sr・Ba・Cu）は `separation.js` がすでに名乗っているが、
//       Ba の色名だけはリポジトリのどこにも無かった。★ 報告で名指ししてある。
//
// 【⚠⚠ 答えは必ず二値】（D-A2）
//   ★ 当てはまらない候補には「当てはまらないと言い切れる文」を札に書く。
//     例:「白色の沈殿ですか」→ Ag⁺ は沈殿ではないので **いいえ**。★ 嘘をついていない。
//   ⛔ 「この教材では扱っていません」を第3の答えにしない（二値でなくなる）。
//
// 【⛔ 出典を画面に書かない】教科書は1社しか読んでいない（CLAUDE.md）。
//   ★ 出す値は「化学式」と「色・水への溶けやすさ」といった事実だけ。

'use strict';

(function () {

    // -----------------------------------------------------------
    // 原子量（高校の概数値）。★ 式量は**ここから計算する**（手で書かない ＝ 打ち間違いが起きない）
    // -----------------------------------------------------------
    var AW = {
        H: 1.0, C: 12, O: 16, Na: 23, Al: 27, S: 32, Cl: 35.5,
        K: 39, Ca: 40, Fe: 56, Cu: 63.5, Zn: 65, Ag: 108, Ba: 137, Pb: 207
    };
    var EL_JP = {
        Ag: '銀', Ba: 'バリウム', Ca: 'カルシウム', Cu: '銅', Pb: '鉛', Fe: '鉄',
        Zn: '亜鉛', Al: 'アルミニウム', Na: 'ナトリウム', K: 'カリウム',
        Cl: '塩素', S: '硫黄', O: '酸素', H: '水素', C: '炭素'
    };
    // 札に出す順（★ 金属 → 非金属。⚠ 周期表の順ではなく、この教材で出会う順）
    var EL_ORDER = ['Ag', 'Ba', 'Ca', 'Cu', 'Pb', 'Fe', 'Zn', 'Al', 'Na', 'K', 'Cl', 'S', 'O', 'H', 'C'];

    // イオンのかたまり（★ 式の中に**その形で**入っているかを見る）
    //   ⚠ Ag₂O は酸化物なので OH⁻ を「ふくまない」。★ ここを反応の由来で埋めない
    var PART_JP = {
        Cl: { name: '塩化物イオン', f: 'Cl⁻' },
        SO4: { name: '硫酸イオン', f: 'SO₄²⁻' },
        CO3: { name: '炭酸イオン', f: 'CO₃²⁻' },
        OH: { name: '水酸化物イオン', f: 'OH⁻' },
        S: { name: '硫化物イオン', f: 'S²⁻' }
    };
    var PART_ORDER = ['Cl', 'SO4', 'CO3', 'OH', 'S'];

    // 炎色反応（★ 色が出るのは7元素だけ。⚠ 候補に出てくるのは Na・K・Ca・Cu・Ba の5つ）
    var FLAME = { Na: '黄色', K: '赤紫色', Ca: '橙赤色', Cu: '青緑色', Ba: '黄緑色' };
    var FLAME_ORDER = ['Na', 'K', 'Ca', 'Cu', 'Ba'];

    // 色の名前と hex。⚠ 名前が主で、hex は名前の見える化にすぎない
    //   （tests.js が「名乗りと色相が食い違っていないか」を機械で見る）
    var AKI_COLORS = {
        '白色': '#ffffff',
        '黒色': '#2c3e50',
        '褐色': '#795548',
        '赤褐色': '#a0522d',
        '青白色': '#85c1e9',
        '青緑色': '#1abc9c',
        '緑白色': '#d4e6d0',
        '黄色': '#f1c40f',
        '赤紫色': '#b0409a',
        '橙赤色': '#e8590c',
        '黄緑色': '#80cc33'
    };
    // 沈殿の色を札にする順（★ 多いものから。⚠ 「褐色」と「赤褐色」は別の色として数える）
    var PPT_COLOR_ORDER = ['白色', '黒色', '褐色', '赤褐色', '青白色', '青緑色', '緑白色'];

    // -----------------------------------------------------------
    // 候補 30件
    //   kind  … 'ppt'（水に溶けにくい沈殿） / 'ion'（水溶液中のイオン）
    //   comp  … 化学式の組成（★ 式量・原子の数・元素の種類はここから計算する）
    //   parts … 式の中にあるイオンのかたまり
    //   sAcid … ⚠ **酸性の水溶液の中でも沈殿している硫化物か**
    //           （★ CuS・PbS・Ag₂S だけ。ZnS・FeS は中性・塩基性でしか沈殿しない）
    // -----------------------------------------------------------
    var PPT = [
        { id: 'AgCl', f: 'AgCl', jp: '塩化銀', color: '白色', comp: { Ag: 1, Cl: 1 }, parts: ['Cl'] },
        { id: 'Ag2O', f: 'Ag₂O', jp: '酸化銀', color: '褐色', comp: { Ag: 2, O: 1 }, parts: [] },
        { id: 'Ag2CO3', f: 'Ag₂CO₃', jp: '炭酸銀', color: '白色', comp: { Ag: 2, C: 1, O: 3 }, parts: ['CO3'] },
        { id: 'Ag2S', f: 'Ag₂S', jp: '硫化銀', color: '黒色', comp: { Ag: 2, S: 1 }, parts: ['S'], sAcid: true },
        { id: 'BaSO4', f: 'BaSO₄', jp: '硫酸バリウム', color: '白色', comp: { Ba: 1, S: 1, O: 4 }, parts: ['SO4'] },
        { id: 'BaCO3', f: 'BaCO₃', jp: '炭酸バリウム', color: '白色', comp: { Ba: 1, C: 1, O: 3 }, parts: ['CO3'] },
        { id: 'CaSO4', f: 'CaSO₄', jp: '硫酸カルシウム', color: '白色', comp: { Ca: 1, S: 1, O: 4 }, parts: ['SO4'] },
        { id: 'CaCO3', f: 'CaCO₃', jp: '炭酸カルシウム', color: '白色', comp: { Ca: 1, C: 1, O: 3 }, parts: ['CO3'] },
        { id: 'CuS', f: 'CuS', jp: '硫化銅(II)', color: '黒色', comp: { Cu: 1, S: 1 }, parts: ['S'], sAcid: true },
        { id: 'CuOH2', f: 'Cu(OH)₂', jp: '水酸化銅(II)', color: '青白色', comp: { Cu: 1, O: 2, H: 2 }, parts: ['OH'] },
        { id: 'CuCO3', f: 'CuCO₃', jp: '炭酸銅(II)', color: '青緑色', comp: { Cu: 1, C: 1, O: 3 }, parts: ['CO3'] },
        { id: 'PbCl2', f: 'PbCl₂', jp: '塩化鉛(II)', color: '白色', comp: { Pb: 1, Cl: 2 }, parts: ['Cl'] },
        { id: 'PbSO4', f: 'PbSO₄', jp: '硫酸鉛(II)', color: '白色', comp: { Pb: 1, S: 1, O: 4 }, parts: ['SO4'] },
        { id: 'PbS', f: 'PbS', jp: '硫化鉛(II)', color: '黒色', comp: { Pb: 1, S: 1 }, parts: ['S'], sAcid: true },
        { id: 'PbOH2', f: 'Pb(OH)₂', jp: '水酸化鉛(II)', color: '白色', comp: { Pb: 1, O: 2, H: 2 }, parts: ['OH'] },
        { id: 'FeS', f: 'FeS', jp: '硫化鉄(II)', color: '黒色', comp: { Fe: 1, S: 1 }, parts: ['S'] },
        { id: 'FeOH2', f: 'Fe(OH)₂', jp: '水酸化鉄(II)', color: '緑白色', comp: { Fe: 1, O: 2, H: 2 }, parts: ['OH'] },
        { id: 'ZnS', f: 'ZnS', jp: '硫化亜鉛', color: '白色', comp: { Zn: 1, S: 1 }, parts: ['S'] },
        { id: 'ZnOH2', f: 'Zn(OH)₂', jp: '水酸化亜鉛', color: '白色', comp: { Zn: 1, O: 2, H: 2 }, parts: ['OH'] },
        { id: 'AlOH3', f: 'Al(OH)₃', jp: '水酸化アルミニウム', color: '白色', comp: { Al: 1, O: 3, H: 3 }, parts: ['OH'] },
        { id: 'FeOOH', f: 'FeO(OH)', jp: '酸化水酸化鉄(III)', color: '赤褐色', comp: { Fe: 1, O: 2, H: 1 }, parts: ['OH'] }
    ];

    // ⚠ イオンの反応は `SEP_TABLE` から写した（★ 新しく調べたマスは無い）:
    //   hcl    希塩酸で沈殿する            … Ag⁺・Pb²⁺
    //   h2s    酸性で硫化水素を通すと沈殿・濁り … Ag⁺・Pb²⁺・Cu²⁺・Fe³⁺
    //   nh3ex  過剰のアンモニア水で溶ける      … Ag⁺・Cu²⁺・Zn²⁺
    //   naohex 過剰の水酸化ナトリウムで溶ける（両性）… Pb²⁺・Zn²⁺・Al³⁺
    //   noNh3  アンモニア水を加えても沈殿しない  … Ca²⁺・Na⁺・K⁺
    //   ★ `sep` … `SEP_IONS` / `SEP_TABLE` のどの行から写したか（⚠ tests.js が突き合わせる鍵）
    var ION = [
        { id: 'Ag+', sep: 'Ag', f: 'Ag⁺', jp: '銀イオン', charge: 1, comp: { Ag: 1 }, rg: ['hcl', 'h2s', 'nh3ex'] },
        { id: 'Pb2+', sep: 'Pb', f: 'Pb²⁺', jp: '鉛(II)イオン', charge: 2, comp: { Pb: 1 }, rg: ['hcl', 'h2s', 'naohex'] },
        { id: 'Cu2+', sep: 'Cu', f: 'Cu²⁺', jp: '銅(II)イオン', charge: 2, comp: { Cu: 1 }, rg: ['h2s', 'nh3ex'] },
        { id: 'Ca2+', sep: 'Ca', f: 'Ca²⁺', jp: 'カルシウムイオン', charge: 2, comp: { Ca: 1 }, rg: ['noNh3'] },
        { id: 'Na+', sep: 'Na', f: 'Na⁺', jp: 'ナトリウムイオン', charge: 1, comp: { Na: 1 }, rg: ['noNh3'] },
        { id: 'K+', sep: 'K', f: 'K⁺', jp: 'カリウムイオン', charge: 1, comp: { K: 1 }, rg: ['noNh3'] },
        { id: 'Zn2+', sep: 'Zn', f: 'Zn²⁺', jp: '亜鉛イオン', charge: 2, comp: { Zn: 1 }, rg: ['nh3ex', 'naohex'] },
        { id: 'Al3+', sep: 'Al', f: 'Al³⁺', jp: 'アルミニウムイオン', charge: 3, comp: { Al: 1 }, rg: ['naohex'] },
        { id: 'Fe3+', sep: 'Fe3', f: 'Fe³⁺', jp: '鉄(III)イオン', charge: 3, comp: { Fe: 1 }, rg: ['h2s'] }
    ];

    var CANDS = [];
    PPT.forEach(function (p) {
        CANDS.push({
            id: p.id, name: p.f, jp: p.jp, kind: 'ppt', color: p.color,
            comp: p.comp, parts: p.parts, sAcid: !!p.sAcid, charge: 0, rg: []
        });
    });
    ION.forEach(function (i) {
        CANDS.push({
            id: i.id, name: i.f, jp: i.jp, kind: 'ion', color: null,
            comp: i.comp, parts: [], sAcid: false, charge: i.charge, rg: i.rg, sep: i.sep
        });
    });

    // --- 式から計算できるもの（★ 表を1マスも書かない列。設計書 §3-1） ---
    function mw(c) {
        var s = 0;
        Object.keys(c.comp).forEach(function (e) { s += AW[e] * c.comp[e]; });
        return Math.round(s * 10) / 10;
    }
    function atoms(c) {
        var s = 0;
        Object.keys(c.comp).forEach(function (e) { s += c.comp[e]; });
        return s;
    }
    function kinds(c) { return Object.keys(c.comp).length; }
    function flameOf(c) {
        for (var i = 0; i < FLAME_ORDER.length; i++) {
            if (c.comp[FLAME_ORDER[i]]) return FLAME[FLAME_ORDER[i]];
        }
        return null;
    }
    CANDS.forEach(function (c) {
        c.mw = mw(c);
        c.atoms = atoms(c);
        c.kinds = kinds(c);
        c.flame = flameOf(c);
    });

    var BY_ID = {};
    CANDS.forEach(function (c) { BY_ID[c.id] = c; });

    // -----------------------------------------------------------
    // 札 —— ★ 1枚ずつ手で書かず、**型からループで作る**（設計書 §3-1・§5-2）
    //   row  … 一覧で畳む行。★ 「ふくむ元素」15枚は1行に横並びになる
    //   tag  … 絞り込みのタグ（⚠ 排他的な分類学ではない・§5-2）
    //   keys … 検索が当たる語（★ 化学式にも当てる・§5-3）
    // -----------------------------------------------------------
    var CARDS = [];
    function card(o) { CARDS.push(o); return o; }

    var ROW_FORM = '沈殿か、イオンか';
    var ROW_COLOR = '沈殿の色';
    var ROW_EL = 'ふくむ元素';
    var ROW_PART = 'ふくむイオンのかたまり';
    var ROW_MW = '式量';
    var ROW_NUM = '原子の数・元素の種類';
    var ROW_CH = '電荷';
    var ROW_GRP = '元素の区分';
    var ROW_FLAME = '炎色反応';
    var ROW_RG = '試薬を加える';

    var TAG_LOOK = '見た目';
    var TAG_CALC = '式から分かる';
    var TAG_CHECK = '確認';
    var TAG_RG = '試薬との反応';

    // ① 沈殿か、イオンか
    card({
        id: 'is-ppt', row: ROW_FORM, tag: TAG_LOOK, cell: '水に溶けにくい沈殿',
        say: '水に溶けにくい沈殿ですか',
        mean: '沈殿（固体）か、水溶液の中のイオンかを分ける',
        keys: ['沈殿', '固体', 'イオン', '水']
    });

    // ② 沈殿の色
    card({
        id: 'col-tint', row: ROW_COLOR, tag: TAG_LOOK, cell: '白でも黒でもない',
        say: '白色でも黒色でもない、色のついた沈殿ですか',
        mean: '沈殿の色を、白・黒と、それ以外に分ける',
        keys: ['色', '沈殿']
    });
    PPT_COLOR_ORDER.forEach(function (col) {
        card({
            id: 'col-' + col, row: ROW_COLOR, tag: TAG_LOOK, cell: col, color: col,
            say: '沈殿の色は「' + col + '」ですか',
            mean: '沈殿の色を見る',
            keys: ['色', '沈殿', col, col.replace('色', '')]
        });
    });

    // ② ふくむ元素
    EL_ORDER.forEach(function (e) {
        card({
            id: 'el-' + e, row: ROW_EL, tag: TAG_CALC, cell: EL_JP[e] + ' ' + e,
            say: EL_JP[e] + ' ' + e + ' をふくみますか',
            mean: '化学式にその元素が入っているかを見る',
            keys: [e, EL_JP[e], '元素']
        });
    });

    // ③ ふくむイオンのかたまり
    PART_ORDER.forEach(function (p) {
        card({
            id: 'an-' + p, row: ROW_PART, tag: TAG_CALC, cell: PART_JP[p].f,
            say: PART_JP[p].name + ' ' + PART_JP[p].f + ' をふくみますか',
            mean: '化学式の中に、そのかたまりがそのまま入っているかを見る',
            keys: [PART_JP[p].name, PART_JP[p].f, p, '陰イオン']
        });
    });

    // ④ 式量（★ 20 刻み。⚠ 候補の式量は 23〜303 に収まっている）
    var MW_STEPS = [];
    for (var t = 40; t <= 300; t += 20) MW_STEPS.push(t);
    MW_STEPS.forEach(function (n) {
        card({
            id: 'mw-' + n, row: ROW_MW, tag: TAG_CALC, cell: n + ' 以上',
            say: '式量は ' + n + ' 以上ですか',
            mean: '式量の大きさで分ける',
            keys: ['式量', '分子量', String(n)]
        });
    });

    // ⑤ 原子の数・元素の種類
    // ⚠ 上は 7（★ 8 以上にすると、当てはまる候補が1つも無い ＝ 押しても何も起きない札になる。実測）
    [2, 3, 4, 5, 6, 7].forEach(function (n) {
        card({
            id: 'at-' + n, row: ROW_NUM, tag: TAG_CALC, cell: '原子 ' + n + ' 個以上',
            say: '化学式の中の原子は、全部で ' + n + ' 個以上ですか',
            mean: '化学式に並んでいる原子の数を数える',
            keys: ['原子', '数', String(n)]
        });
    });
    [1, 2, 3].forEach(function (n) {
        card({
            id: 'kind-' + n, row: ROW_NUM, tag: TAG_CALC, cell: '元素 ' + n + ' 種類',
            say: 'ふくまれる元素は ' + n + ' 種類ですか',
            mean: '化学式に出てくる元素の種類を数える',
            keys: ['元素', '種類', String(n)]
        });
    });

    // ⑥ 電荷
    card({
        id: 'ch-ion', row: ROW_CH, tag: TAG_CALC, cell: '陽イオン',
        say: '陽イオンですか',
        mean: '電荷をもつかどうかを見る',
        keys: ['陽イオン', '電荷', 'イオン']
    });
    card({
        id: 'ch-2', row: ROW_CH, tag: TAG_CALC, cell: '電荷 2 以上',
        say: '電荷の大きさは 2 以上ですか',
        mean: 'イオンの価数を見る',
        keys: ['電荷', '価数', '2']
    });
    card({
        id: 'ch-3', row: ROW_CH, tag: TAG_CALC, cell: '電荷 3',
        say: '電荷の大きさは 3 ですか',
        mean: 'イオンの価数を見る',
        keys: ['電荷', '価数', '3']
    });

    // ⑦ 元素の区分
    card({
        id: 'grp-alkali', row: ROW_GRP, tag: TAG_CALC, cell: 'アルカリ金属',
        say: 'アルカリ金属（Na・K）をふくみますか',
        mean: '1族の金属をふくむかを見る',
        keys: ['アルカリ金属', 'Na', 'K', '1族']
    });
    card({
        id: 'grp-alkaline', row: ROW_GRP, tag: TAG_CALC, cell: 'アルカリ土類金属',
        say: 'アルカリ土類金属（Ca・Ba）をふくみますか',
        mean: '2族の金属をふくむかを見る',
        keys: ['アルカリ土類金属', 'Ca', 'Ba', '2族']
    });

    // ⑧ 炎色反応（★ 色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7元素だけ）
    card({
        id: 'fl-any', row: ROW_FLAME, tag: TAG_CHECK, cell: '色が出る',
        say: '炎色反応で色を示す元素をふくみますか',
        mean: '白金線につけて外炎に入れ、炎に色がつくかを見る',
        keys: ['炎色反応', '炎', '色']
    });
    FLAME_ORDER.forEach(function (e) {
        card({
            id: 'fl-' + e, row: ROW_FLAME, tag: TAG_CHECK, cell: FLAME[e], color: FLAME[e],
            say: '炎色反応は「' + FLAME[e] + '」ですか',
            mean: '炎についた色を見る',
            keys: ['炎色反応', '炎', FLAME[e], FLAME[e].replace('色', ''), e, EL_JP[e]]
        });
    });

    // ⑨ 試薬を加える（⚠ **水溶液中のイオンについての札**。★ 沈殿はイオンではないので「いいえ」）
    var RG = [
        { id: 'hcl', cell: '希塩酸で沈殿する', say: '希塩酸を加えると沈殿するイオンですか', mean: '塩化物が水に溶けにくいイオンかを見る', keys: ['希塩酸', '塩酸', 'HCl', '沈殿'] },
        { id: 'h2s', cell: '硫化水素で沈殿・濁り', say: '酸性にして硫化水素を通すと、沈殿や濁りができるイオンですか', mean: '酸性でも硫化物が沈殿するか（鉄(III) は硫黄の濁り）を見る', keys: ['硫化水素', 'H2S', '酸性', '沈殿', '濁り'] },
        { id: 'nh3ex', cell: 'NH₃ 過剰で溶ける', say: '過剰のアンモニア水を加えると溶けるイオンですか', mean: '錯イオンになって溶けるかを見る', keys: ['アンモニア', 'NH3', '過剰', '錯イオン', '溶ける'] },
        { id: 'naohex', cell: 'NaOH 過剰で溶ける', say: '過剰の水酸化ナトリウム水溶液に溶ける（両性の）イオンですか', mean: '両性の水酸化物をつくるかを見る', keys: ['水酸化ナトリウム', 'NaOH', '過剰', '両性', '溶ける'] },
        { id: 'noNh3', cell: 'NH₃ で沈殿しない', say: 'アンモニア水を加えても沈殿しないイオンですか', mean: '水酸化物の沈殿ができないかを見る', keys: ['アンモニア', 'NH3', '沈殿しない'] }
    ];
    RG.forEach(function (r) {
        card({ id: 'rg-' + r.id, row: ROW_RG, tag: TAG_RG, cell: r.cell, say: r.say, mean: r.mean, keys: r.keys });
    });
    card({
        id: 'rg-sacid', row: ROW_RG, tag: TAG_RG, cell: '酸性でも沈殿する硫化物',
        say: '酸性の水溶液の中でも沈殿している硫化物ですか',
        mean: '硫化物のうち、酸性でも沈殿するもの（CuS・PbS・Ag₂S）かを見る',
        keys: ['硫化物', '酸性', '沈殿', 'S']
    });

    // -----------------------------------------------------------
    // 答え —— ⚠⚠ **必ず二値**
    // -----------------------------------------------------------
    function answer(candId, cardId) {
        var c = BY_ID[candId];
        if (!c) return false;
        var m;

        if (cardId === 'is-ppt') return c.kind === 'ppt';
        if (cardId === 'col-tint') {
            return c.kind === 'ppt' && c.color !== '白色' && c.color !== '黒色';
        }
        if ((m = /^col-(.+)$/.exec(cardId))) return c.kind === 'ppt' && c.color === m[1];
        if ((m = /^el-(.+)$/.exec(cardId))) return !!c.comp[m[1]];
        if ((m = /^an-(.+)$/.exec(cardId))) return c.parts.indexOf(m[1]) >= 0;
        if ((m = /^mw-(\d+)$/.exec(cardId))) return c.mw >= Number(m[1]);
        if ((m = /^at-(\d+)$/.exec(cardId))) return c.atoms >= Number(m[1]);
        if ((m = /^kind-(\d+)$/.exec(cardId))) return c.kinds === Number(m[1]);
        if (cardId === 'ch-ion') return c.charge > 0;
        if (cardId === 'ch-2') return c.charge >= 2;
        if (cardId === 'ch-3') return c.charge === 3;
        if (cardId === 'grp-alkali') return !!(c.comp.Na || c.comp.K);
        if (cardId === 'grp-alkaline') return !!(c.comp.Ca || c.comp.Ba);
        if (cardId === 'fl-any') return c.flame !== null;
        if ((m = /^fl-(.+)$/.exec(cardId))) return c.flame === FLAME[m[1]];
        if (cardId === 'rg-sacid') return !!c.sAcid;
        if ((m = /^rg-(.+)$/.exec(cardId))) return c.rg.indexOf(m[1]) >= 0;
        return false;
    }

    // -----------------------------------------------------------
    // 答え合わせの一文（★ 「あなたの質問でこうなりました」の材料）
    //   ⚠ 出典（本の名前・ページ）は書かない。★ 化学の言葉だけで言う
    // -----------------------------------------------------------
    function why(candId, cardId) {
        var c = BY_ID[candId];
        if (!c) return '';
        var n = c.name, m;
        var isPpt = c.kind === 'ppt';

        if (cardId === 'is-ppt') {
            return isPpt ? n + '（' + c.jp + '）は水に溶けにくい沈殿です。'
                : n + ' は水溶液の中のイオンで、沈殿ではありません。';
        }
        if (cardId === 'col-tint' || /^col-/.test(cardId)) {
            if (!isPpt) return n + ' は沈殿ではないので、沈殿の色はありません。';
            return n + ' の沈殿は' + c.color + 'です。';
        }
        if ((m = /^el-(.+)$/.exec(cardId))) {
            var e = m[1];
            return c.comp[e] ? n + ' は' + EL_JP[e] + ' ' + e + ' をふくみます。'
                : n + ' は' + EL_JP[e] + ' ' + e + ' をふくみません。';
        }
        if ((m = /^an-(.+)$/.exec(cardId))) {
            var p = PART_JP[m[1]];
            return c.parts.indexOf(m[1]) >= 0
                ? n + ' は' + p.name + ' ' + p.f + ' をふくみます。'
                : n + ' は' + p.name + ' ' + p.f + ' をふくみません。';
        }
        if (/^mw-/.test(cardId)) return n + ' の式量は ' + c.mw + ' です。';
        if (/^at-/.test(cardId)) return n + ' の化学式に並ぶ原子は、全部で ' + c.atoms + ' 個です。';
        if (/^kind-/.test(cardId)) return n + ' にふくまれる元素は ' + c.kinds + ' 種類です。';
        if (/^ch-/.test(cardId)) {
            return c.charge > 0 ? n + ' は電荷の大きさが ' + c.charge + ' の陽イオンです。'
                : n + ' は電荷をもたない物質です。';
        }
        if (cardId === 'grp-alkali') {
            return (c.comp.Na || c.comp.K) ? n + ' はアルカリ金属をふくみます。'
                : n + ' はアルカリ金属をふくみません。';
        }
        if (cardId === 'grp-alkaline') {
            return (c.comp.Ca || c.comp.Ba) ? n + ' はアルカリ土類金属をふくみます。'
                : n + ' はアルカリ土類金属をふくみません。';
        }
        if (/^fl-/.test(cardId)) {
            return c.flame ? n + ' の炎色反応は' + c.flame + 'です。'
                : n + ' は、炎色反応で色を示す元素をふくみません。';
        }
        if (cardId === 'rg-sacid') {
            if (!isPpt) return n + ' はイオンそのもので、硫化物の沈殿ではありません。';
            if (c.sAcid) return n + ' は、酸性の水溶液に硫化水素を通しても沈殿します。';
            if (c.parts.indexOf('S') >= 0) return n + ' は硫化物ですが、酸性では沈殿せず、中性か塩基性で沈殿します。';
            return n + ' は硫化物ではありません。';
        }
        if ((m = /^rg-(.+)$/.exec(cardId))) {
            if (!isPpt) {
                var yes = c.rg.indexOf(m[1]) >= 0;
                var txt = {
                    hcl: ['希塩酸を加えると沈殿します', '希塩酸を加えても沈殿しません'],
                    h2s: ['酸性で硫化水素を通すと、沈殿か濁りができます', '酸性で硫化水素を通しても、変化は見えません'],
                    nh3ex: ['アンモニア水を過剰に加えると、いったんできた沈殿が溶けます', 'アンモニア水を過剰に加えても溶けません'],
                    naohex: ['水酸化ナトリウム水溶液を過剰に加えると、いったんできた沈殿が溶けます', '水酸化ナトリウム水溶液を過剰に加えても溶けません'],
                    noNh3: ['アンモニア水を加えても沈殿しません', 'アンモニア水を加えると沈殿ができます']
                }[m[1]];
                return n + ' は' + (yes ? txt[0] : txt[1]) + '。';
            }
            return n + ' は沈殿そのもので、水溶液の中のイオンではありません。';
        }
        return '';
    }

    // -----------------------------------------------------------
    // ★★ 割れない組の申し送り（D-A6・§7-4）
    //   ⚠ **潰さない。**答え合わせで「なぜ割れないか」を化学の言葉で言う。
    // -----------------------------------------------------------
    var BLACK_S = ['CuS', 'PbS', 'Ag2S'];
    function afterNote(truthId) {
        if (BLACK_S.indexOf(truthId) >= 0) {
            return 'CuS・PbS・Ag₂S は、どれも黒色で、どれも酸性の水溶液の中で沈殿します。'
                + '色と液性だけでは、この3つは分かれません。'
                + '濃硝酸に溶かしてから過剰のアンモニア水を加えると、銅だけが深青色の溶液になります。';
        }
        if (truthId === 'FeS' || truthId === 'ZnS') {
            return 'FeS と ZnS は、中性か塩基性でしか沈殿しません。'
                + '酸性の水溶液に硫化水素を通しても沈殿しないところが、CuS・PbS・Ag₂S との分かれ目です。';
        }
        return null;
    }

    // -----------------------------------------------------------
    var DECK = {
        id: 'muki1',
        name: '無機・第1段',
        sub: '沈殿 21 ＋ 水溶液中のイオン 9 ＝ 30',
        colors: AKI_COLORS,
        cands: CANDS,
        cards: CARDS,
        answer: answer,
        why: why,
        afterNote: afterNote
    };

    var reg = (typeof akiRegisterDeck === 'function') ? akiRegisterDeck
        : (typeof require === 'function' ? require('./akinator-model.js').akiRegisterDeck : null);
    if (reg) reg(DECK);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { AKI_DECK_MUKI1: DECK, AKI_COLORS: AKI_COLORS };
    } else if (typeof window !== 'undefined') {
        window.AKI_DECK_MUKI1 = DECK;
        window.AKI_COLORS = AKI_COLORS;
    }
})();
