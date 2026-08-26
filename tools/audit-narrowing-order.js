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
//   [R] stepNo        … 札1枚ごとの実験番号（★ 2026-08-26 に出荷 JSON へ載せた）。
//                        **番号を持っているのに stack と対応が取れていない**ものだけを赤にし、
//                        非昇順（＝解き筋の順が問題文の順と違う）は数えて見せるだけ
//
// 出荷データでは**言えない**こと:
//   ・「札が問題文の実験と違う」…… 出荷 JSON は試薬名を1つも持っていない（持ち出さない）。
//     仕様側（_解析/db/narrowing/*.json）の step.label と test を突き合わせるしかない
//   ⚠ **「順が問題文と違う」はかつてここに並んでいた**。実験番号が1文字も載っていなかったため
//     判定が原理的に不可能で、それが「見えなくなる」の正体だった。[R] がその穴を塞いだ
//
// 仕様ディレクトリを渡したときに追加で言えること（出荷列 ←→ 仕様 target を**添字**で結ぶ）:
//   [K0] 作り直しの一致  … 仕様の steps を翻訳し直した並びが、出荷 stack と一致するか。
//                        一致する ＝ **生成器は並べ替えを一切していない**ことの機械証明
//   [K] 実験番号の昇順 … step.label から「実験N」「操作N」「条件(N)」「(N)」「(ア)」「(a)」を拾い、
//                        **相異なる番号を2つ以上もつ列**について昇順かどうかを見る。
//                        ⚠ 同じ番号だけの列・番号の無い列・系列が混ざる列は**判定不能**（分けて数える）
//   [L] 札の取り違え   … step.label の「＝」より左（＝問題文の実験）に出る試薬の語と、
//                        実際に積まれた札が食い違う件。**3つに分ける**:
//                        ① 素直な札に差し替えても expect が保たれる ＝ 対応表の穴（直せる）
//                        ② 差し替えると expect が壊れる ＝ その札は与件や前段の推論を抱えている
//                        ③ 素直な札がアプリに無い ＝ 畳むしかない
//                        ⚠ 判定するのは**肯定・否定の両方が1枚の札で言い切れる試薬だけ**。
//                        加水分解・還元・酸化は「何が得られたか」で意味が変わるので**わざと見ない**
//   [M] 語彙の穴       … 述語対応表からたどり着けないアプリの札（＝仕様が書きたくても書けない実験）
//   [N] 順番を直した影響 … 途中の数と「減らない」の出方の実測（最終値・必須・最短は動かない）
//   [O] 札を直した影響   … 最終値・必須・最短手数・ルート数の実測
//   [P] 影響のまとめ     … ①②を直すと**画面の答えが実際に変わる列**の数
//   [Q] 崩れた場所       … db/problems.jsonl の routes（解き筋）まで遡り、
//                        **解き筋の側が既に非昇順か**を見る。そうなら崩したのは仕様ではなく解き筋
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

// ---- [R] stepNo（★ 2026-08-26 に出荷 JSON へ載せた）----
// ⚠⚠ **ここまでの検査は「順番が問題文どおりか」を1つも言えなかった。**
//   出荷 JSON に実験番号が1文字も無かったからで、判定には仕様ディレクトリが要った
//   （＝ 出荷したデータだけを見ている人には**永久に見えない**）。
//   `stepNo`（札1枚ごとの実験番号）を載せたので、ここから下は**出荷 JSON だけで**言える。
//
// ★ **何を赤にするか**（設計。ここを間違えると見張りが嘘をつく）:
//   赤 …「番号を持っているのに `stack` と対応が取れていない」ほうだけ。
//        R1 長さが `stack` と違う ／ R2 要素が正の整数でも null でもない ／
//        R3 全部 null（欄はあるのに中身が無い＝「番号が無い」と「番号を落とした」が混ざる。
//           番号が拾えない列は**欄ごと作らない**のが規約） ／ R4 `stack` が空なのに欄がある
//   ⚠ **非昇順は赤にしない。** `stack` の順は**解き筋の順**で、それが教材の実体。
//        問題文の順と違うこと自体は誤りではないので、**数えて見せるだけ**にする
const R = { bad: [], noAsc: [], partial: [], none: [] };
P.forEach((p) => p.columns.forEach((col) => {
    const w = `${p.printed || p.id} / ${col.name}`;
    const s = col.stepNo;
    if (s === undefined) { R.none.push(w); return; }
    if (!Array.isArray(s)) { R.bad.push(`${w}: stepNo が配列でない（${JSON.stringify(s)}）`); return; }
    if (s.length !== col.stack.length) { R.bad.push(`${w}: stepNo ${s.length} 個 / stack ${col.stack.length} 枚 ＝ 対応が取れていない`); return; }
    if (!col.stack.length) { R.bad.push(`${w}: stack が空なのに stepNo がある`); return; }
    const ng = s.filter((v) => v !== null && !(Number.isInteger(v) && v > 0));
    if (ng.length) { R.bad.push(`${w}: 正の整数でも null でもない値 ${JSON.stringify(ng)}`); return; }
    const n = s.filter((v) => v !== null);
    if (!n.length) { R.bad.push(`${w}: stepNo が全部 null（番号が拾えない列は欄ごと作らない規約）`); return; }
    if (n.length !== s.length) R.partial.push(`${w}: ${JSON.stringify(s)}`);
    if (!n.every((v, i) => i === 0 || v >= n[i - 1])) R.noAsc.push(`${w}: ${s.join(' → ')}  [${col.stack.join(',')}]`);
}));
console.log(`\n[R] stepNo（出荷 JSON だけで見られる）: 欄あり ${cols - R.none.length} 本 / 欄なし ${R.none.length} 本`);
console.log(`    ⚠ **赤（stack と対応が取れていない）: ${R.bad.length} 件**`);
R.bad.forEach((s) => console.log('        ⚠ ' + s));
console.log(`    ・一部の札だけ番号を持つ列（残りは null）: ${R.partial.length} 本`);
R.partial.forEach((s) => console.log('        ・' + s));
console.log(`    ・**非昇順 ＝ 解き筋の順が問題文の順と違う列: ${R.noAsc.length} 本**（誤りではない。数えるだけ）`);
R.noAsc.forEach((s) => console.log('        ・' + s));
console.log('    ・欄なし ＝ 番号が1つも拾えない列（解析者が立てた「対照」など）と、');
console.log('      番号の系列が混ざる列（「実験4 → 問イ」）。どちらも並べ替えにも検査にも使えない');

// ---- [K]〜[O] 仕様ディレクトリがあるときだけ ----
// ⚠ **出荷 JSON だけでは順番も札も判定できない**（実験番号も試薬名も入っていない）。
//   仕様（_解析/db/narrowing/*.json）と述語対応表（_解析/tools/narrowing-predicates.js）を
//   渡して初めて、出荷列 ←→ 仕様 step の対応が付く。
//   対応は**添字**で取る —— build-narrowing-data.js は spec.targets を順に columns へ
//   push しているだけなので、`columns[i]` は `spec.targets[i]` そのもの。
const specDir = process.argv[2];
if (!specDir) {
    console.log('\n[K]〜[O] 仕様ディレクトリ（_解析/db/narrowing）が渡されていないので省略。');
    console.log('       ⚠ **出荷 JSON には実験番号も試薬名も入っていない**ので、');
    console.log('       「問題文の順と違う」「問題文の札と違う」は出荷データだけでは判定できない。');
    process.exit(0);
}
if (!fs.existsSync(specDir)) { console.log(`\n⚠ 仕様ディレクトリが見つからない: ${specDir}`); process.exit(0); }
// ⚠ **`marker`（step.label から実験番号を拾う関数）も向こうから借りる。**
//   もとはこのファイルにも同じ正規表現の写しがあったが、書き出し側（build-narrowing-data.js）が
//   `stepNo` を作るのに同じ関数を使う以上、**2か所に持つと片方だけ直したときに黙ってずれる**
//   （出荷された番号と、それを検査する番号が別の規則になる ＝ 見張りが嘘をつく）。
const { MAP, marker } = require(path.resolve(specDir, '..', '..', 'tools', 'narrowing-predicates.js'));

// ---- 仕様の test 1つ → カード id の配列（build-narrowing-data.js の translate と同じ規則）----
function cardsOf(test, asConstraint) {
    if (typeof test === 'string') { const e = MAP[test]; return e && e.card ? [e.card] : []; }
    if (test && test.and) return test.and.flatMap((t) => cardsOf(t, asConstraint));
    if (test && test.chiral !== undefined) return asConstraint ? [] : [test.chiral >= 1 ? 'optical' : 'optical-no'];
    if (test && test.ring !== undefined) return CARD.has(`ring${test.ring}`) ? [`ring${test.ring}`] : [];
    return [];
}

// ---- 実験の語 → その実験を**そのまま**言うアプリの札 ----
// ⚠ **上から順に最初に当たったものを採る。** 「炭酸水素ナトリウム」「ヨウ素と水酸化ナトリウム」は
//   「ナトリウム」を含むので、長いほうを先に置かないと誤検出する
// ⚠ **この表に載せるのは「肯定・否定の両方が1枚の札で言い切れる」試薬だけ**にしてある。
//   加水分解・還元・酸化のように「何が得られたか」で意味が変わるものは、
//   機械が「素直な札」を決められないので**わざと載せない**（誤報を出すより黙るほうがよい）
const LITERAL = [
    [/炭酸水素ナトリウム|NaHCO/, 'acid-no', 'acid'],
    [/ヨードホルム|ヨウ素と水酸化ナトリウム/, 'iodo-no', 'iodo'],
    [/水素(を)?付加|水素の付加|水素付加|H2\s*付加/, 'h2-no', null],
    [/臭素水/, 'br2-no', 'br2'],
    [/銀鏡|フェーリング/, 'silver-no', 'silver'],
    [/ニンヒドリン/, 'ninhydrin-no', 'ninhydrin'],
    [/ナトリウム|Na と|Na を/, 'na-no', 'na'],
];
const NEG = /(ない|なかった|陰性|示さな|しな|起きな|でない|出ない|無い|ず、|ずに)/;
// label は「問題文の実験 ＝ 解析者が引き出した結論」の二段構え。**判定に使うのは ＝ の左**
const lhs = (L) => String(L || '').split(/[＝=]/)[0];

const SPEC = {};
for (const f of fs.readdirSync(specDir).sort()) {
    if (f.startsWith('_') || !f.endsWith('.json')) continue;
    const s = JSON.parse(fs.readFileSync(path.join(specDir, f), 'utf8'));
    SPEC[s.id] = { file: f, spec: s };
}

// ---- 出荷列 ←→ 仕様 target を結び、カード1枚ずつに step を貼る ----
const linked = [];   // { where, p, col, target, cards:[{id, label, marker}] }
let rebuildNG = 0;
P.filter((p) => p.columns.length).forEach((p) => {
    const S = SPEC[p.id]; if (!S) return;
    p.columns.forEach((col, i) => {
        const t = (S.spec.targets || [])[i]; if (!t) return;
        const cards = [];
        (t.steps || []).forEach((st) => {
            cardsOf(st.test, !!st.asConstraint).forEach((id) => cards.push({ id, label: st.label || '', marker: marker(st.label) }));
        });
        if (cards.map((c) => c.id).join(',') !== col.stack.join(',')) rebuildNG++;
        linked.push({ where: `${p.printed || p.id} / ${col.name}`, p, col, target: t, cards });
    });
});

console.log(`\n[K0] 仕様から作り直した stack が出荷 stack と一致した列: ${linked.length - rebuildNG} / ${linked.length} 本`);
console.log('     ⚠ 一致する ＝ **生成器は並べ替えを一切していない**（仕様の steps の並びがそのまま stack）。');
console.log('     順番の責任は生成器ではなく仕様側にある、ということが機械で言える');
if (rebuildNG) console.log(`     ⚠ 一致しない列が ${rebuildNG} 本ある。翻訳規則が変わった可能性`);

// ---- [K] 順番が問題文の番号と食い違うか（出荷列ごと）----
const K = { trivial: [], ok: [], ng: [], ties: [], none: [], mixed: [] };
linked.forEach((L) => {
    if (L.col.stack.length <= 1) { K.trivial.push(L.where); return; }
    const ms = L.cards.map((c) => c.marker).filter(Boolean);
    const series = [...new Set(ms.map((m) => m.s))];
    if (series.length > 1) { K.mixed.push(`${L.where}: ${ms.map((m) => m.s + m.n).join(' → ')}`); return; }
    const nums = ms.map((m) => m.n);
    if (new Set(nums).size < 2) { (ms.length ? K.ties : K.none).push(`${L.where}: ${L.col.stack.join(',')}`); return; }
    const asc = nums.every((v, i) => i === 0 || v >= nums[i - 1]);
    (asc ? K.ok : K.ng).push(`${L.where}: ${series[0]} ${nums.join(' → ')}`);
});
console.log(`\n[K] 順番が問題文の番号と合っているか（出荷 ${linked.length} 列）`);
console.log(`    ・順番が意味を持たない（札が1枚以下） … ${K.trivial.length} 本`);
console.log(`    ・相異なる番号を2つ以上もつ＝**判定できる** … ${K.ok.length + K.ng.length} 本`);
console.log(`        昇順（問題文どおり） ${K.ok.length} 本 / **非昇順（食い違い） ${K.ng.length} 本**`);
K.ng.forEach((s) => console.log('        ⚠ ' + s));
console.log(`    ・番号は付いているが同じ番号だけ＝判定に効かない … ${K.ties.length} 本`);
console.log(`    ・番号の系列が混ざる＝判定しない … ${K.mixed.length} 本`);
K.mixed.forEach((s) => console.log('        ・' + s));
console.log(`    ・番号がまったく無い＝**判定不能** … ${K.none.length} 本`);
K.none.forEach((s) => console.log('        ・' + s));

// ---- [L] 札が問題文の実験と食い違うか（出荷列ごと・カード1枚ずつ）----
const L1 = [], L2 = [];   // L1: 素直な札があるのに別の札（＝取り違え） / L2: 素直な札がアプリに無い（＝畳むしかない）
linked.forEach((L) => {
    L.cards.forEach((c, i) => {
        const head = lhs(c.label);
        const hit = LITERAL.find(([re]) => re.test(head)); if (!hit) return;
        const want = NEG.test(head) ? hit[1] : hit[2];
        if (want === c.id) return;
        const row = `${L.where}: 「${head.trim()}」→ ${c.id}（${(CARD.get(c.id).say || [])[0]}）`;
        if (want === null) L2.push(row + '  ※この向きの札はアプリに無い');
        else L1.push({ where: L.where, idx: i, from: c.id, to: want, text: row + `  ⇒ 素直には ${want}（${(CARD.get(want).say || [])[0]}）` });
    });
});
// ⚠ **「素直な札と違う」だけでは、直すべきかどうかが決まらない。**
//   素直な札に差し替えて `expect`（仕様が書いた正解の残り数）が保たれるかを実測して分ける:
//     保たれる … 畳む必要が無かった ＝ **純粋な取り違え。差し替えれば直る**
//     壊れる   … その札は**問題文の与件や前段の推論を抱えている** ＝ 差し替えたら答えが狂う。
//                直すなら札を1枚足すか制約に回すかで、単純な差し替えでは直らない
L1.forEach((r) => {
    const L = linked.find((x) => x.where === r.where);
    const pool = poolOf(L.p.formula, L.p.constraints);
    r.swapFinal = pool ? applyAll(pool, L.col.stack.map((id, i) => (i === r.idx ? r.to : id))).length : null;
    r.safe = r.swapFinal === L.col.expect;
});
const L1a = L1.filter((r) => r.safe), L1b = L1.filter((r) => !r.safe);
console.log(`\n[L] 札が問題文の実験と食い違う（判定できる試薬に限る）: ${L1.length + L2.length} 件`);
console.log(`    ①**対応表の穴 ＝ 素直な札があり、差し替えても expect が保たれる … ${L1a.length} 件**（直せる）`);
L1a.forEach((r) => console.log('        ⚠ ' + r.text));
console.log(`    ②同値と見なした ＝ 素直な札はあるが、差し替えると expect が壊れる … ${L1b.length} 件（与件・推論を抱えた札）`);
L1b.forEach((r) => console.log(`        ・${r.text}  ※差し替えると ${r.swapFinal} 通り（仕様の expect は ${linked.find((x) => x.where === r.where).col.expect}）`));
console.log(`    ③素直な札がアプリに無いので畳むしかない … ${L2.length} 件`);
L2.forEach((s) => console.log('        ・' + s));

// ---- [M] 述語対応表からたどり着けないアプリの札 ----
// ⚠ optical / optical-no / ringN は translate() が {chiral} {ring:N} から直に作るので除く
const viaMap = new Set(Object.values(MAP).map((e) => e.card).filter(Boolean));
const viaCode = new Set(['optical', 'optical-no', ...NARROW_CARDS.map((c) => c.id).filter((id) => /^ring[3-8]$/.test(id))]);
const unreachable = NARROW_CARDS.map((c) => c.id).filter((id) => !viaMap.has(id) && !viaCode.has(id));
console.log(`\n[M] 述語対応表（narrowing-predicates.js）からたどり着けない札: ${unreachable.length} 枚`);
console.log('    ' + unreachable.join(' ') + '  ⇐ **仕様はこの実験を書きたくても書けない**');

// ---- [N][O] 影響の実測 ----
const measure = (pool, stack) => {
    let l = pool; const seq = [pool.length]; const dead = [];
    stack.forEach((id, i) => { const b = l.length; l = l.filter(CARD.get(id).test); seq.push(l.length); if (l.length === b) dead.push(`${i + 1}枚目 ${id}`); });
    const final = l.length;
    const need = stack.filter((id, i) => applyAll(pool, stack.filter((_, j) => j !== i)).length !== final);
    let short = null, routes = 0;
    for (let k = 1; k <= stack.length && !short; k++) {
        const acc = []; const comb = (s, cur) => {
            if (cur.length === k) { if (applyAll(pool, cur).length === final) acc.push(cur.slice()); return; }
            for (let j = s; j < stack.length; j++) comb(j + 1, cur.concat(stack[j]));
        }; comb(0, []);
        if (acc.length) { short = k; routes = acc.length; }
    }
    return { seq, final, dead, need, short, routes };
};
const line = (tag, r) => `        ${tag.padEnd(22)} ${r.seq.join('→').padEnd(24)} 最終 ${r.final} / 必須 ${r.need.length}枚 / 最短 ${r.short}手・${r.routes}通り / 減らない[${r.dead.join('・')}]`;

console.log('\n[N] 順番を問題文どおりに直すと画面はどう変わるか（[K] の食い違い分）');
K.ng.forEach((s) => {
    const L = linked.find((x) => s.startsWith(x.where + ':')); if (!L) return;
    const pool = poolOf(L.p.formula, L.p.constraints); if (!pool) return;
    const order = L.cards.map((c, i) => ({ i, n: c.marker ? c.marker.n : -1 })).sort((a, b) => a.n - b.n || a.i - b.i);
    const fixed = order.map((o) => L.col.stack[o.i]);
    console.log(`    ${L.where}`);
    console.log(line('いまのデータ順', measure(pool, L.col.stack)));
    console.log(line('問題文の番号順', measure(pool, fixed)));
});

console.log('\n[O] 札を素直なものに差し替えると画面はどう変わるか（[L] の①②）');
const changed = new Set();
L1.forEach((r) => {
    const L = linked.find((x) => x.where === r.where);
    const pool = poolOf(L.p.formula, L.p.constraints); if (!pool) return;
    const a = measure(pool, L.col.stack);
    const b = measure(pool, L.col.stack.map((id, i) => (i === r.idx ? r.to : id)));
    console.log(`    ${L.where}  ${r.from} → ${r.to}  ${r.safe ? '【差し替え可】' : '【差し替え不可・expect が壊れる】'}`);
    console.log(line(`いまのデータ（${r.from}）`, a));
    console.log(line(`素直な札（${r.to}）`, b));
    if (r.safe && (a.short !== b.short || a.routes !== b.routes || a.need.length !== b.need.length
        || a.dead.join() !== b.dead.join() || a.seq.join() !== b.seq.join())) changed.add(L.where);
});

// ---- [P] 影響のまとめ ----
// ⚠ **順番と札で効くところが違う。**
//   順番 … 途中の数と「減らない」の出方だけ。最終値・必須の枚数・最短手数は AND が可換なので**動かない**
//   札   … 最終値・必須・最短手数まで動く
K.ng.forEach((s) => {
    const L = linked.find((x) => s.startsWith(x.where + ':')); if (!L) return;
    const pool = poolOf(L.p.formula, L.p.constraints); if (!pool) return;
    const order = L.cards.map((c, i) => ({ i, n: c.marker ? c.marker.n : -1 })).sort((a, b) => a.n - b.n || a.i - b.i);
    const a = measure(pool, L.col.stack), b = measure(pool, order.map((o) => L.col.stack[o.i]));
    if (a.seq.join() !== b.seq.join() || a.dead.join() !== b.dead.join()) changed.add(L.where);
});
console.log(`\n[P] ①②を直すと**画面の答えが実際に変わる列**: ${changed.size} 本 / ${linked.length} 本`);
[...changed].forEach((s) => console.log('    ⚠ ' + s));
console.log(`    ・順番の食い違い ${K.ng.length} 本 ＋ 差し替えられる取り違え ${L1a.length} 件 が直す対象`);
console.log(`    ・${L1b.length} 件（与件を抱えた札）と ${L2.length} 件（札が無い）は、単純な差し替えでは直せない`);

// ---- [Q] 順番はどこで崩れたのか —— 解き筋（db/problems.jsonl の routes）まで遡る ----
// ⚠ **narrowing の steps は「問題文の順」ではなく「解析者が書いた解き筋の順」を写している**、
//   という仮説をここで確かめる。routes[].steps[].out にも同じ実験番号が書いてあるので、
//   **route の側が既に非昇順なら、崩したのは narrowing の仕様ではなく解き筋**ということになる
const jsonl = path.resolve(specDir, '..', 'problems.jsonl');
if (!fs.existsSync(jsonl)) { console.log('\n[Q] db/problems.jsonl が無いので省略。'); process.exit(0); }
let rT = 0, rNum = 0, rNG = [];
fs.readFileSync(jsonl, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).forEach((p) => {
    (p.routes || []).forEach((r) => {
        rT++;
        const nums = (r.steps || []).map((s) => marker(s.out)).filter(Boolean).map((m) => m.n);
        if (new Set(nums).size < 2) return;
        rNum++;
        if (!nums.every((v, i) => i === 0 || v >= nums[i - 1])) rNG.push(`${p.printed || p.id} / route ${r.id}: ${nums.join(' → ')}`);
    });
});
console.log(`\n[Q] 解き筋（routes）の側の実験番号: route ${rT} 本中 ${rNum} 本が判定でき、非昇順は ${rNG.length} 本`);
rNG.forEach((s) => console.log('    ⚠ ' + s));
console.log('    ⚠ **narrowing の仕様が崩したのではなく、解き筋がもともとその順**なら、');
console.log('    「問題文の順」を持たせるには解き筋とは別の欄が要る（解き筋は解き筋で正しい）');
