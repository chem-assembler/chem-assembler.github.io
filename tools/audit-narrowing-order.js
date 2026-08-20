#!/usr/bin/env node
// 絞り込みモードのプリセット（assembler/narrowing-problems.json）を機械で検査する。
//
//   node tools/audit-narrowing-order.js            # 出荷データだけを見る
//   node tools/audit-narrowing-order.js <仕様ディレクトリ>  # _解析/db/narrowing も見る
//
// ⚠ **読むだけ。** narrowing-problems.json は JSON.parse するが、書き戻さない
//   （CLAUDE.md の「データを書き戻すな」。この道具は一切ファイルを書かない）。
//
// ------------------------------------------------------------------
// 何をどう数えるか
// ------------------------------------------------------------------
// 前提: プリセットの `stack` は「実験カードを積む順」で、アプリは前から順に候補を絞る。
//       最終の残り数は順番に依らない（AND は可換）が、**途中の数は順番で変わる**。
//
// 出荷データだけで言えること（問題文が要らない検査）:
//   [A] 規模          … 問題数・列数・stack の長さの分布
//   [B] expect≠got    … 生成器が書いた検算値と実測のずれ（本来 0 件）
//   [C] 未知の札      … NARROW_CARDS に無い id が stack に入っている
//   [D] 札の重複      … 同じ id が1つの stack に2回
//   [E] 矛盾する対    … `na` と `na-no` のように打ち消し合う札が同居
//   [F] 空の stack    … 札が1枚も無い列
//   [G] 効かない札    … その位置で候補を1つも減らさない札（残り数が同じ）
//   [H] 冗長な札      … その札を抜いても**最終の**残り数が変わらない札
//   [I] 順序で効きが変わる札 … [G] のうち、**先頭に置けば**減る札
//                        ＝ その stack が「効く順」に並べ替えられている証拠
//   [J] 最短手数      … stack の部分集合で同じ最終値に届く最小枚数。
//                        stack の長さより短ければ、その列は最短ではない
//
// 出荷データでは**言えない**こと:
//   ・「問題文の実験の順と違う」…… 出荷 JSON は実験番号を1つも持っていない。
//     判定するには仕様側（_解析/db/narrowing/*.json）の step.label が要る
//   ・「札が問題文の実験と違う」…… 同上。仕様の step.label と test を突き合わせるしかない
//
// 仕様ディレクトリを渡したときに追加で言えること:
//   [K] 実験番号の昇順 … step.label から「実験N」「操作N」「(N)」を拾い、
//                        2つ以上拾えた target について昇順かどうかを見る。
//                        ⚠ 番号を書いていない step は判定不能（数えて明示する）
//   [L] 試薬名と述語のずれ … step.label に出る試薬・操作の語（水素付加・臭素水・ヨードホルム …）と、
//                        test が指す述語の系統が食い違う step。
//                        ⚠ **これは誤りの検出ではない。** 仕様の step は
//                        「label＝問題文の実験／test＝そこから解析者が引き出した結論」という
//                        二段構えなので、ずれているのが普通。**どれだけ畳まれているかの計測**
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'assembler');

global.window = global;
eval(fs.readFileSync(path.join(APP, 'chemistry.js'), 'utf8'));
eval(fs.readFileSync(path.join(APP, 'narrowing.js'), 'utf8'));

const DATA = JSON.parse(fs.readFileSync(path.join(APP, 'narrowing-problems.json'), 'utf8'));
const P = DATA.problems;
const CARD = new Map(NARROW_CARDS.map((c) => [c.id, c]));

// 打ち消し合う札の対（id と id+'-no'、および同じ行を排他に埋める札）
const OPPOSITE = (id) => (id.endsWith('-no') ? id.slice(0, -3) : id + '-no');

// ---- 候補集合 ----
const BAKED = JSON.parse(fs.readFileSync(path.join(APP, 'isomers-baked.json'), 'utf8')).isomers;
const mkFromBaked = (r) => {
    const m = new Molecule();
    const ids = r.e.split(',').map((el) => m.addAtom(el, 0, 0).id);
    r.b.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
    return m;
};
const poolOf = (key, cons) => {
    const f = NARROW_FORMULAS.find((x) => x.key === key);
    if (!f) return null;
    let list = f.ring ? ringPlacements(f.ring.size, f.ring.subs).map((x) => x.mol)
        : f.baked ? BAKED[key].map(mkFromBaked)
            : enumerateConstitutionalIsomers(f.elements, f.h, 20000000).isomers;
    if (!cons) return list;
    if (cons.noEnol) list = list.filter((m) => !NW.groups(m).includes('enol'));
    if (cons.chiral !== '') list = list.filter((m) => NW.chiral(m) === +cons.chiral);
    if (cons.ring === 'yes') list = list.filter((m) => !!NW.ring(m));
    if (cons.ring === 'no') list = list.filter((m) => !NW.ring(m));
    return list;
};
const applyAll = (pool, stack) => stack.reduce((l, id) => l.filter(CARD.get(id).test), pool);

// ---- 集計 ----
const hist = {};
const found = { B: [], C: [], D: [], E: [], F: [], G: [], H: [], I: [], J: [] };
let cols = 0;

P.forEach((p) => {
    p.columns.forEach((col) => {
        cols++;
        hist[col.stack.length] = (hist[col.stack.length] || 0) + 1;
        const where = `${p.printed || p.id} / ${col.name}`;
        if (col.expect !== col.got) found.B.push(`${where}: expect ${col.expect} / got ${col.got}`);
        col.stack.filter((id) => !CARD.has(id)).forEach((id) => found.C.push(`${where}: 未知の札 ${id}`));
        if (new Set(col.stack).size !== col.stack.length) found.D.push(`${where}: ${col.stack.join(',')}`);
        col.stack.forEach((id) => { if (col.stack.includes(OPPOSITE(id)) && id < OPPOSITE(id)) found.E.push(`${where}: ${id} と ${OPPOSITE(id)}`); });
        if (!col.stack.length) found.F.push(where);
    });
});

P.filter((p) => p.columns.length).forEach((p) => {
    const pool = poolOf(p.formula, p.constraints);
    if (!pool) return;
    p.columns.forEach((col) => {
        if (!col.stack.length || col.stack.some((id) => !CARD.has(id))) return;
        const where = `${p.printed || p.id} / ${col.name}`;
        // [G] 途中で効かない札 / [I] 先頭なら効く札
        let l = pool;
        const seq = [pool.length];
        col.stack.forEach((id, i) => {
            const before = l.length;
            l = l.filter(CARD.get(id).test);
            seq.push(l.length);
            if (l.length === before) {
                const alone = pool.filter(CARD.get(id).test).length;
                found.G.push(`${where}: ${i + 1}枚目 ${id} は減らさない（${before}→${before}）`);
                if (alone < pool.length) found.I.push(`${where}: ${id}（単独なら ${pool.length}→${alone}）`);
            }
        });
        const final = l.length;
        // [H] 抜いても最終値が変わらない札
        col.stack.forEach((id, i) => {
            const rest = col.stack.filter((_, j) => j !== i);
            if (applyAll(pool, rest).length === final) found.H.push(`${where}: ${id} を抜いても ${final} のまま`);
        });
        // [J] 最短手数
        let best = null;
        for (let k = 1; k < col.stack.length && !best; k++) {
            const comb = (start, cur) => {
                if (best) return;
                if (cur.length === k) { if (applyAll(pool, cur).length === final) best = cur.slice(); return; }
                for (let j = start; j < col.stack.length; j++) comb(j + 1, cur.concat(col.stack[j]));
            };
            comb(0, []);
        }
        if (best) found.J.push(`${where}: ${col.stack.length}枚 → 最短 ${best.length}枚（${best.join('+')}）  ${seq.join('→')}`);
    });
});

const show = (k, title) => {
    console.log(`\n[${k}] ${title}: ${found[k].length} 件`);
    found[k].forEach((s) => console.log('    ' + s));
};

console.log(`[A] 規模: 問題 ${P.length} 件 / 列 ${cols} 本`
    + ` / 列が0本の問題（断片のみ） ${P.filter((p) => !p.columns.length).length} 件`
    + ` / splits をもつ問題 ${P.filter((p) => p.splits).length} 件`);
console.log('    stack の長さの分布: ' + Object.keys(hist).sort((a, b) => a - b).map((k) => `${k}枚×${hist[k]}`).join(' / '));
const used = new Set(P.flatMap((p) => p.columns.flatMap((c) => c.stack)));
console.log(`    使われた札 ${used.size} 種 / アプリの札 ${NARROW_CARDS.length} 種`);
console.log('    一度も使われない札: ' + NARROW_CARDS.map((c) => c.id).filter((id) => !used.has(id)).join(' '));

show('B', 'expect ≠ got');
show('C', '未知の札');
show('D', '同じ札が2回');
show('E', '打ち消し合う札の同居');
show('F', '空の stack');
show('G', 'その位置で減らさない札');
show('I', 'うち「先頭なら減る」札（＝順番で効きが変わる）');
show('H', '抜いても最終値が変わらない札（冗長）');
show('J', 'stack が最短でない列');

// ---- [K][L] 仕様ディレクトリがあるときだけ ----
const specDir = process.argv[2];
if (!specDir) {
    console.log('\n[K][L] 仕様ディレクトリ（_解析/db/narrowing）が渡されていないので省略。');
    console.log('       ⚠ **出荷 JSON には実験番号も試薬名も入っていない**ので、');
    console.log('       「問題文の順と違う」「問題文の札と違う」は出荷データだけでは判定できない。');
    process.exit(0);
}
if (!fs.existsSync(specDir)) { console.log(`\n⚠ 仕様ディレクトリが見つからない: ${specDir}`); process.exit(0); }

const zen = (s) => s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
const NUMPAT = [/^[（(]\s*([0-9０-９]+)\s*[）)]/, /(?:実験|操作|設問|問)\s*[（(]?\s*([0-9０-９]+)/];
// 試薬・操作の語 → その語が素直に対応する述語の系統
const REAGENT = [
    [/水素付加|水素を付加|水素と反応/, '水素付加'],
    [/臭素水|臭素を|Br2/, '臭素'],
    [/ヨードホルム/, 'ヨードホルム'],
    [/銀鏡|フェーリング/, '銀鏡'],
    [/ナトリウム(?!水溶液)|Na と|Na を/, 'ナトリウム'],
    [/オゾン/, 'オゾン'],
    [/ニンヒドリン/, 'ニンヒドリン'],
    [/炭酸水素ナトリウム|NaHCO/, '炭酸水素Na'],
];
const PREDGROUP = {
    '炭素間二重結合なし': '臭素', '炭素間二重結合あり': '臭素',
    'ヨードホルム陽性': 'ヨードホルム', 'ヨードホルム陰性': 'ヨードホルム',
    'アルデヒド': '銀鏡', 'アルデヒドでない': '銀鏡',
    'ヒドロキシ基あり': 'ナトリウム', 'ヒドロキシ基なし': 'ナトリウム',
    'オゾン分解で1種類': 'オゾン', 'オゾン分解で2種類': 'オゾン',
    'ニンヒドリンで青紫': 'ニンヒドリン', 'ニンヒドリンで青紫にならない': 'ニンヒドリン',
    'カルボキシ基あり': '炭酸水素Na', 'カルボキシ基なし': '炭酸水素Na',
};
const flatTests = (t, o = []) => {
    if (typeof t === 'string') o.push(t);
    else if (t && t.and) t.and.forEach((x) => flatTests(x, o));
    else if (t) o.push(JSON.stringify(t));
    return o;
};

let targets = 0, numbered = 0, mono = 0, steps = 0, stepsNumbered = 0;
const nonMono = [], drift = [];
for (const f of fs.readdirSync(specDir).sort()) {
    if (f.startsWith('_') || !f.endsWith('.json')) continue;
    const spec = JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8'));
    (spec.targets || []).forEach((t) => {
        targets++;
        const nums = [];
        (t.steps || []).forEach((s) => {
            steps++;
            const L = s.label || '';
            let n = null;
            for (const p of NUMPAT) { const m = p.exec(L); if (m) { n = +zen(m[1]); break; } }
            if (n !== null) { nums.push(n); stepsNumbered++; }
            const r = REAGENT.find(([re]) => re.test(L));
            if (r) {
                const preds = flatTests(s.test);
                const groups = preds.map((p) => PREDGROUP[p]).filter(Boolean);
                if (!groups.includes(r[1])) drift.push(`${f} / ${t.label}: 「${r[1]}」の実験 → 述語「${preds.join('+')}」`);
            }
        });
        if (nums.length < 2) return;
        numbered++;
        const ok = nums.every((v, i) => i === 0 || v >= nums[i - 1]);
        if (ok) mono++; else nonMono.push(`${f} / ${t.label}: ${nums.join(' → ')}`);
    });
}
console.log(`\n[K] 実験番号の昇順: target ${targets} 本 / step ${steps} 個`);
console.log(`    番号を拾えた step ${stepsNumbered} 個（${steps - stepsNumbered} 個は番号を書いていない＝判定不能）`);
console.log(`    番号が2つ以上拾えた target ${numbered} 本 … 昇順 ${mono} 本 / 非昇順 ${nonMono.length} 本`);
nonMono.forEach((s) => console.log('    ⚠ ' + s));
console.log(`    ⚠ 残り ${targets - numbered} 本は番号が足りず**順序の食い違いを判定できない**`);

console.log(`\n[L] 試薬名と述語の系統がずれる step: ${drift.length} 件`);
drift.forEach((s) => console.log('    ' + s));
console.log('    ⚠ これは誤りの数ではない。仕様は label＝実験／test＝解析者の結論の二段構えなので、');
console.log('    ずれ＝「実験そのものではなく、そこから引き出した結論を札にした」ことの計測');
