/**
 * reactions.json（反応機構データ）の機械検証（Node で実行。ブラウザ不要）
 *
 *   node tools/verify-reactions.js
 *
 * 機構データを追加・修正したときに、投入前・コミット前に必ず通すためのツール。
 * compounds.json 用の verify-compounds.js と同じ立ち位置で、
 * 「作ってみたら再生できない・原子が消えている」事故を投入前に止める。
 *
 * 検査項目:
 *   1. 形式: 必須キー・id の一意性・states と steps のつながり（from/to が実在するか）
 *   2. 各状態が分子として成立しているか（結合の添字・自己結合・重複結合・価標）
 *   3. **状態間で原子が保存されているか**（元素ごとの個数。機構は原子を作らない・消さない）
 *   4. **電荷の総和が全状態で一定か**（電子の行き先を追うのが機構なので、増減は誤り）
 *   5. 巻矢印が実在する原子・結合を指しているか
 *   6. 状態が steps で全部つながるか（孤立した状態＝画面に出ない状態が無いか）
 *   7. 原子どうしが近すぎないか（作図が潰れていないか）
 *   8. reactor.js の mechanismId がすべて実在するか（「機構を見る」ボタンの死にリンク検出）
 *
 * 終了コード 0 = 合格、1 = 問題あり
 *
 * 注意: 価標は「電荷を考慮した上限」で見る。機構の途中には
 * カルボカチオン（C の結合3本・電荷+1）やオキソニウム（O の結合3本・電荷+1）が出るため、
 * 電荷ぶんだけ上限をずらして判定する（+1 なら C は3本、O は3本まで）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'assembler');
const MAX_VALENCY = { C: 4, O: 2, N: 3, S: 6, H: 1, Cl: 1, Br: 1 };
const MIN_DIST = 20; // 原子どうしの最小距離（px）。これ未満は作図が潰れている

const problems = [];
const warnings = [];
const reactions = JSON.parse(fs.readFileSync(path.join(ROOT, 'reactions.json'), 'utf8'));

// 電荷を考慮した価標の上限。陽イオンは結合を1本多く持てる（C⁺ は例外で1本少ない）
function valencyLimit(element, charge) {
    const base = MAX_VALENCY[element];
    if (base === undefined) return null;
    if (!charge) return base;
    if (element === 'C') return base + charge * -1; // C⁺ は3本（空のp軌道）
    return base + charge;                            // O⁺・N⁺ は1本多い
}

const ids = new Set();
reactions.forEach((rx, ri) => {
    const where = `reactions.json[${ri}] ${rx.id || '(idなし)'}`;

    // 1. 形式
    ['id', 'name', 'series', 'desc', 'states', 'steps'].forEach(k => {
        if (rx[k] === undefined) problems.push(`${where}: 必須キー "${k}" がありません`);
    });
    if (!Array.isArray(rx.states) || rx.states.length < 2) {
        problems.push(`${where}: states が2つ以上ありません（機構は変化を見せるものです）`);
        return;
    }
    if (!Array.isArray(rx.steps) || rx.steps.length < 1) {
        problems.push(`${where}: steps がありません`);
        return;
    }
    if (ids.has(rx.id)) problems.push(`${where}: id が重複しています`);
    ids.add(rx.id);

    // 2. 各状態が分子として成立しているか
    const counts = [];
    const charges = [];
    rx.states.forEach((st, si) => {
        const at = `${where} / 状態${si}`;
        if (!Array.isArray(st.atoms) || !Array.isArray(st.bonds)) {
            problems.push(`${at}: atoms / bonds がありません`);
            return;
        }
        const used = st.atoms.map(() => 0);
        const seenPairs = new Set();
        st.bonds.forEach((b, bi) => {
            const { atom1Index: i, atom2Index: j, type } = b;
            if (!(i >= 0 && i < st.atoms.length) || !(j >= 0 && j < st.atoms.length)) {
                problems.push(`${at}: 結合${bi} が存在しない原子を指しています（${i}-${j}）`);
                return;
            }
            if (i === j) { problems.push(`${at}: 結合${bi} が同じ原子どうしです`); return; }
            if (!(type >= 1 && type <= 3)) { problems.push(`${at}: 結合${bi} の次数が ${type}`); return; }
            const key = i < j ? `${i}_${j}` : `${j}_${i}`;
            if (seenPairs.has(key)) problems.push(`${at}: 同じ原子対に結合が2本あります（${i}-${j}）`);
            seenPairs.add(key);
            used[i] += type;
            used[j] += type;
        });
        st.atoms.forEach((a, ai) => {
            const limit = valencyLimit(a.element, a.charge || 0);
            if (limit === null) { problems.push(`${at}: 未知の元素 "${a.element}"`); return; }
            if (used[ai] > limit) {
                problems.push(`${at}: 原子${ai}(${a.element}${a.charge ? (a.charge > 0 ? '+' : '-') : ''}) の結合が ${used[ai]} 本（上限 ${limit}）`);
            }
            if (typeof a.x !== 'number' || typeof a.y !== 'number') {
                problems.push(`${at}: 原子${ai} に座標がありません`);
            }
        });
        // 7. 近すぎる原子
        for (let p = 0; p < st.atoms.length; p++) {
            for (let q = p + 1; q < st.atoms.length; q++) {
                const d = Math.hypot(st.atoms[p].x - st.atoms[q].x, st.atoms[p].y - st.atoms[q].y);
                if (d < MIN_DIST) {
                    problems.push(`${at}: 原子${p} と 原子${q} が近すぎます（${d.toFixed(1)}px）`);
                }
            }
        }
        // 3・4 のための集計
        const c = {};
        st.atoms.forEach(a => { c[a.element] = (c[a.element] || 0) + 1; });
        counts.push(c);
        charges.push(st.atoms.reduce((s, a) => s + (a.charge || 0), 0));
    });

    // 3. 原子の保存（機構の途中で原子が湧いたり消えたりしてはいけない）
    const base = counts[0] || {};
    counts.forEach((c, si) => {
        if (si === 0) return;
        const elements = new Set([...Object.keys(base), ...Object.keys(c)]);
        elements.forEach(e => {
            if ((base[e] || 0) !== (c[e] || 0)) {
                problems.push(`${where}: 状態0 と 状態${si} で ${e} の数が違います（${base[e] || 0} → ${c[e] || 0}）`);
            }
        });
    });

    // 4. 電荷の総和
    charges.forEach((q, si) => {
        if (si > 0 && q !== charges[0]) {
            problems.push(`${where}: 状態0 と 状態${si} で電荷の合計が違います（${charges[0]} → ${q}）`);
        }
    });

    // 5・6. steps の整合と巻矢印
    const reached = new Set();
    rx.steps.forEach((sp, spi) => {
        const at = `${where} / 手順${spi}`;
        if (!(sp.from >= 0 && sp.from < rx.states.length)) {
            problems.push(`${at}: from=${sp.from} が状態の範囲外です`);
            return;
        }
        if (!(sp.to >= 0 && sp.to < rx.states.length)) {
            problems.push(`${at}: to=${sp.to} が状態の範囲外です`);
            return;
        }
        if (sp.from === sp.to) problems.push(`${at}: from と to が同じ状態です`);
        if (!sp.caption) problems.push(`${at}: caption（解説）がありません`);
        reached.add(sp.from);
        reached.add(sp.to);
        const st = rx.states[sp.from];
        const hasBond = (i, j) => st.bonds.some(b =>
            (b.atom1Index === i && b.atom2Index === j) || (b.atom1Index === j && b.atom2Index === i));
        (sp.arrows || []).forEach((ar, ai) => {
            [['source', ar.source], ['target', ar.target]].forEach(([kind, ep]) => {
                if (!ep || !ep.type) { problems.push(`${at}: 矢印${ai} の ${kind} が不正です`); return; }
                if (ep.type === 'atom') {
                    if (!(ep.index >= 0 && ep.index < st.atoms.length)) {
                        problems.push(`${at}: 矢印${ai} の ${kind} が存在しない原子 ${ep.index} を指しています`);
                    }
                } else if (ep.type === 'bond' || ep.type === 'mid') {
                    const [i, j] = ep.atoms || [];
                    if (!(i >= 0 && i < st.atoms.length) || !(j >= 0 && j < st.atoms.length)) {
                        problems.push(`${at}: 矢印${ai} の ${kind} が存在しない原子を指しています（${i},${j}）`);
                    } else if (ep.type === 'bond' && !hasBond(i, j)) {
                        problems.push(`${at}: 矢印${ai} の ${kind} が「状態${sp.from}に無い結合」${i}-${j} を指しています`);
                    }
                } else {
                    problems.push(`${at}: 矢印${ai} の ${kind} の type が "${ep.type}"（atom / bond / mid のいずれか）`);
                }
            });
            if (ar.style && !['pair', 'single'].includes(ar.style)) {
                problems.push(`${at}: 矢印${ai} の style が "${ar.style}"（pair / single のいずれか）`);
            }
        });
    });
    rx.states.forEach((_, si) => {
        if (!reached.has(si)) warnings.push(`${where}: 状態${si} はどの手順にも出てきません（画面に出ません）`);
    });
});

// 8. reactor.js の mechanismId がすべて実在するか（「この反応の機構を見る」の死にリンク検出）
const reactorSrc = fs.readFileSync(path.join(ROOT, 'reactor.js'), 'utf8');
const refs = [...reactorSrc.matchAll(/mechanismId:\s*'([^']+)'/g)].map(m => m[1]);
[...new Set(refs)].forEach(id => {
    if (!ids.has(id)) problems.push(`reactor.js: mechanismId '${id}' に対応する機構が reactions.json にありません`);
});

console.log(`検査した機構: ${reactions.length} 件（状態 ${reactions.reduce((s, r) => s + r.states.length, 0)} / 手順 ${reactions.reduce((s, r) => s + r.steps.length, 0)}）`);
console.log(`reactor.js から参照されている機構: ${new Set(refs).size} 件`);
if (warnings.length) {
    console.log(`△ 警告 ${warnings.length} 件:`);
    warnings.forEach(w => console.log('  - ' + w));
}
if (problems.length === 0) {
    console.log('✅ 不合格の問題はありません');
    process.exit(0);
}
console.log(`❌ ${problems.length} 件の問題:`);
problems.forEach(p => console.log('  - ' + p));
process.exit(1);
