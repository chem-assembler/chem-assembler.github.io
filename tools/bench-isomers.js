/**
 * 異性体の列挙にかかる費用を測る（DEVELOPMENT.md §7-1d の判断材料）
 *
 *   node tools/bench-isomers.js
 *
 * 「書き出し練習」の入口 `startFromFormula` は **重原子6個まで**に絞っている（learn.js）。
 * qa の `org.aro.c8h10-isomers` が C₈H₁₀（重原子8個）を指しているので、
 * **上限を上げてよいかを実装の前に測る**ための道具。
 *
 * 測るもの: 分子式ごとの ①所要時間 ②列挙された異性体数 ③打ち切り（overflow）の有無。
 * `enumerateConstitutionalIsomers` 自体は重原子8個まで対応していて（9個以上は即 overflow）、
 * 節点の上限は learn.js の `IP_ENUM_LIMIT = 4000000`。ここでも同じ値を使う。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => Date.now() } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

const IP_ENUM_LIMIT = 4000000; // learn.js と同じ

// 分子式 → { heavy: [元素…], h: 個数 }（learn.js の parseFormula と同じ考え方の簡易版）
function parse(formula) {
    const heavy = [];
    let h = 0;
    const re = /(Cl|Br|[CHONS])(\d*)/g;
    let m;
    while ((m = re.exec(formula)) !== null) {
        const n = m[2] ? parseInt(m[2], 10) : 1;
        if (m[1] === 'H') h += n;
        else for (let i = 0; i < n; i++) heavy.push(m[1]);
    }
    return { heavy, h };
}

const CASES = [
    // 重原子5個まで（いまも軽い側）
    ['C5H12', '今の出題（ペンタン類）'],
    ['C4H10O', ''],
    // 重原子6個 …… いまの上限
    ['C6H14', '今の出題（ヘキサン類）'],
    ['C6H12', '不飽和・環を含む'],
    ['C5H12O', '今の出題（C5 のアルコール・エーテル）'],
    ['C6H6', 'ベンゼンの分子式'],
    // 重原子7個 …… 上限を1つ上げたとき
    ['C7H16', 'ヘプタン類'],
    ['C7H14', '不飽和・環を含む'],
    ['C6H14O', 'C6 のアルコール・エーテル'],
    ['C7H8', 'トルエンの分子式'],
    // 重原子8個 …… qa が指している側
    ['C8H18', 'オクタン類'],
    ['C8H10', '⭐ qa の org.aro.c8h10-isomers（キシレン3種＋エチルベンゼン）'],
    ['C8H16', '不飽和・環を含む'],
    ['C7H16O', 'C7 のアルコール・エーテル'],
    ['C8H8', 'スチレンの分子式']
];

// ベンゼン環を種にした列挙（v910）と**同じ土俵で比べる**ための追加列。
// 総当たりが 26秒/3523種 の C₈H₁₀ を、種つきが 8ms/4種 で返すことがここで読める
console.log('■ 総当たり（enumerateConstitutionalIsomers） vs 種つき（enumerateBenzeneRingIsomers）\n');
console.log('分子式      重原子  総当たり(ms)  種数  打切 │ 種つき(ms)  種数  打切  備考');
console.log('-'.repeat(108));
const rows = [];
CASES.forEach(([formula, note]) => {
    const { heavy, h } = parse(formula);
    const t0 = Date.now();
    let res;
    try {
        res = W.enumerateConstitutionalIsomers(heavy, h, IP_ENUM_LIMIT);
    } catch (e) {
        console.log(`${formula.padEnd(11)} ${String(heavy.length).padStart(4)}   —  例外: ${e.message}`);
        return;
    }
    const ms = Date.now() - t0;
    // 種つき経路。適用外（炭素6個未満・環外が多すぎる）なら「—」
    const t1 = Date.now();
    const bz = W.enumerateBenzeneRingIsomers(heavy, h);
    const bzMs = Date.now() - t1;
    rows.push({ formula, heavy: heavy.length, ms, n: res.isomers.length, overflow: res.overflow, bzMs, bz });
    console.log(
        formula.padEnd(11) +
        String(heavy.length).padStart(4) + '  ' +
        String(ms).padStart(11) + '  ' +
        String(res.isomers.length).padStart(5) + '  ' +
        (res.overflow ? 'あり' : 'なし') + ' │ ' +
        String(bz.applicable ? bzMs : '—').padStart(9) + '  ' +
        String(bz.applicable && !bz.overflow ? bz.isomers.length : '—').padStart(5) + '  ' +
        (bz.applicable ? (bz.overflow ? 'あり' : 'なし') : ' — ') + '  ' + note
    );
});

console.log('\n重原子の個数ごとの最悪値（この列が体感を決める）:');
[5, 6, 7, 8].forEach(k => {
    const g = rows.filter(r => r.heavy === k);
    if (!g.length) return;
    const worst = g.reduce((a, b) => (a.ms > b.ms ? a : b));
    const most = g.reduce((a, b) => (a.n > b.n ? a : b));
    console.log(`  重原子 ${k} 個 … 最も遅い ${worst.formula} ${worst.ms}ms ／ 最も多い ${most.formula} ${most.n} 種`);
});

// 種つき経路の最悪ケース。**環の外に置く重原子の数**が費用を決める（DEVELOPMENT.md §7-1f）。
// 硫黄は価標6なので置換基の骨格が桁違いに増える ＝ ここが上限を決めた根拠
console.log('\n■ 種つき経路の最悪ケース（環外の重原子ごと。上限 ' + W.BENZENE_REST_MAX + ' 個の根拠）');
const REST_CASES = [
    [['C', 'C', 'C', 'C', 'C', 'C', 'C'], 8, 1, 'C₇H₈（トルエン）'],
    [['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], 10, 2, '⭐ C₈H₁₀（qa の org.aro.c8h10-isomers）'],
    [['C', 'C', 'C', 'C', 'C', 'C', 'C', 'C', 'C'], 12, 3, 'C₉H₁₂'],
    [['C', 'C', 'C', 'C', 'C', 'C', 'C', 'O', 'N', 'S'], 9, 4, 'C₇H₉ONS（環外4個の最悪）'],
    [['C', 'C', 'C', 'C', 'C', 'C', 'S', 'S', 'S', 'S'], 6, 4, 'C₆H₆S₄（硫黄4個）'],
    [['C', 'C', 'C', 'C', 'C', 'C', 'S', 'S', 'S', 'S', 'S'], 6, 5, 'C₆H₆S₅（環外5個 ＝ 上限外。断る）']
];
console.log('分子式                 環外  時間(ms)  種数  打切  備考');
REST_CASES.forEach(([heavy, h, rest, note]) => {
    const t = Date.now();
    const r = W.enumerateBenzeneRingIsomers(heavy, h);
    const ms = Date.now() - t;
    console.log(
        note.split('（')[0].padEnd(22) +
        String(rest).padStart(3) + String(ms).padStart(9) +
        String(r.overflow ? '—' : r.isomers.length).padStart(6) +
        (r.overflow ? '  あり' : '  なし') + '  ' + note
    );
});
