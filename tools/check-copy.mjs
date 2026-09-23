/**
 * 参考書の原稿が、参考にした文献の文章の**写し**になっていないかを調べる（2026-09-23・ユーザー
 * 「参考にした文献の文章のコピーになっていないか検査する必要がある」）。
 *
 *   node tools/check-copy.mjs --corpus=<文献の文字のフォルダ> [--min=20] [--ja=12] [--page=<id>] [--show=60]
 *   node tools/check-copy.mjs --corpus=<…> --nums [--slides=<スライドの文字>] [--numk=3] [--numwin=300] [--qa]   … 数値だけ同じ例題（I-0117）
 *
 * ★ 文献の文字（教科書・参考書の書き起こし）は**私的な作業用で、リポジトリには置かない**
 *   （マイドライブ/化学/…/_text や、PDF から抜いた scratchpad の文字）。この道具は場所を引数でもらうだけ。
 *   ⚠ 文献の文字が無い環境では何もしない（CI では回さない）
 *
 * やり方: 両方を「空白・改行を除き、句読点と英数字を NFKC でそろえた」文字列にし、
 *   原稿の各ページで **min 文字（既定 20）以上続けて文献と同じ**所を探す。見つけた所は、
 *   実際に文献の中に同じ並びがあることを確かめてから、ページ・長さ・文献名を出す。
 *   ⚠ 化学式・物質名の羅列（「H₂SO₄ ＋ 2NaOH → Na₂SO₄ ＋ 2H₂O」など）は、誰が書いても同じになる。
 *     反応式・化学式の行（:::reaction の left/right、表の行の式だけのもの）は照合から外す
 * 出力は「要る所だけ」: 長い順。本文の一致した並びは確かめのために出す（ローカルの画面だけ・ファイルには書かない）
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'reference-src');
const args = process.argv.slice(2);
const arg = k => (args.find(a => a.startsWith('--' + k + '=')) || '').slice(k.length + 3);
const CORPUS = arg('corpus');
const MIN = Number(arg('min') || 20);
const ONLY = arg('page');
if (!CORPUS || !existsSync(CORPUS)) {
    console.log('文献の文字のフォルダ（--corpus=）がありません。照合しません');
    process.exit(0);
}

/* そろえる: NFKC・空白と改行を除く・句読点の揺れ（，．／、。）をそろえる・強調の ** を除く */
const norm = s => s.normalize('NFKC').replace(/\*\*/g, '').replace(/[，,]/g, '、').replace(/[．]/g, '。')
    .replace(/\s+/g, '');

/* 文献: フォルダの下の .txt / .md を全部（1段下まで） */
const files = [];
const walk = (d, depth) => readdirSync(d).forEach(n => {
    const p = path.join(d, n);
    const st = statSync(p);
    if (st.isDirectory()) { if (depth < 2 && !n.startsWith('_pages')) walk(p, depth + 1); return; }
    if (/\.(txt|md)$/i.test(n)) files.push(p);
});
walk(CORPUS, 0);
const docs = files.map(f => ({ name: path.relative(CORPUS, f), text: norm(readFileSync(f, 'utf8')) }))
    .filter(d => d.text.length > 200);

/* 文献の MIN 文字の並びを全部、ハッシュで覚える（32bit・当たったら本文で確かめるので衝突は害にならない） */
const hash = (s, i, n) => { let h = 2166136261; for (let k = i; k < i + n; k++) { h ^= s.charCodeAt(k); h = Math.imul(h, 16777619); } return h >>> 0; };
const seen = new Set();
docs.forEach(d => { for (let i = 0; i + MIN <= d.text.length; i++) seen.add(hash(d.text, i, MIN)); });

/* 原稿: 前書き・メモ（//）・出典（source:）・反応式の left/right・図の gen/src/svg/mark を外した本文 */
const pageText = md => {
    const body = md.replace(/^---[\s\S]*?\n---\n/, '');
    return body.split(/\r?\n/).filter(l => !/^\/\//.test(l) && !/^(source|src|svg|gen|mark|between|shot|left|right|over|under|arrow|level|anchor|to|app|id|align|head|ordered|advanced|tone|kind):/.test(l)
        && !/^:::/.test(l)).join('\n');
};
/* ==========================================================================
 * ★ --nums（I-0117・2026-09-24 ユーザー「する」）… **数値だけ同じ例題**を拾う。
 *   文の照合（下）は、問題文を言い換えて数値を教科書のまま残した例題（元素分析・イオン交換樹脂で実際にあった）を拾えない。
 *   やり方: 例題の問題文（原稿の `prompt:`・--qa なら問い）から「目立つ数値」を取り出し、
 *   文献の中で **NUMWIN 字（既定 300）以内に、そのうち NUMK 個（既定 3）以上がそろって出る所**を探す。
 *   「目立つ数値」＝ 小数（12.0・7.20）か 10 以上の整数。⚠ 原子量・よく使う定数（12・16・22.4・96500 など）は外す
 *   （誰の問題にも出るので、そろっても写しの証拠にならない）。
 *   ★ `--slides=<ユーザーのスライドの文字のフォルダ>` を渡すと、同じ数値の組がスライドにもある例題に
 *   「スライドの数値」と印を付ける —— ユーザーの決め「例題の数値はスライドを優先・設定が似るのは許容」
 *   （slide-numbers-for-examples）。印の付いたものは直さなくてよい。
 * ========================================================================== */
if (args.includes('--nums')) {
    const NUMK = Number(arg('numk') || 3), NUMWIN = Number(arg('numwin') || 300);
    const COMMON = new Set(['1.0', '12', '14', '16', '23', '24', '27', '32', '35.5', '39', '40', '56', '63.5', '64', '65', '108', '127',
        '22.4', '96500', '9.65', '6.0', '6.02', '8.3', '8.31', '0.082', '1.01', '100', '1000', '10', '25', '273', '298', '1.013', '1.0×10',
        '18', '44', '28', '98', '58.5', '40.0', '36.5', '60', '46', '180', '342', '342.0']);
    /* ⚠ 指数は数値として拾わない。「1.0 × 10⁵」は NFKC で「1.0×105」になり、105・1023 が
     *   どの文献にも出る「数値」として当たってしまう（2026-09-24 の試走で雑音の半分がこれだった） */
    const dropExp = (t) => t.replace(/[×x]10[-−‐]?\d{1,2}/g, '×E');
    const numsOf = (str) => {
        const out = new Set();
        (dropExp(str.normalize('NFKC').replace(/\s+/g, '')).match(/\d+\.\d+|\d{2,}/g) || [])
            .forEach(n => { if (!COMMON.has(n)) out.add(n); });
        return [...out];
    };
    const posIn = (text) => {   // 文献の数値の出現位置（前後が数字・小数点でない完全一致）
        const m = new Map();
        const t = dropExp(text);   // ⚠ 置き換えは同じ長さではないので、位置は置き換えた後の文字で数える（窓の目安なので十分）
        const re = /\d+(?:\.\d+)?/g; let r;
        while ((r = re.exec(t))) { if (!m.has(r[0])) m.set(r[0], []); m.get(r[0]).push(r.index); }
        return m;
    };
    /* ★ 物性値（どの教科書・問題集にも同じ値で出る表の値）。そろったのがこれだけなら「物性値」と印を付けて後ろへ回す
     *   —— 結合エンタルピー・生成／燃焼エンタルピー・電気陰性度・等電点・電離定数・脱水の温度など。写しの証拠にならない */
    const DATA = new Set(['436', '463', '498', '416', '1664', '432', '242', '193', '151', '946',
        '394', '286', '242', '1368', '891', '1561', '1411', '1300', '2219', '283', '111', '396', '1.9',
        '2.2', '2.6', '3.4', '3.0', '4.0', '3.2', '2.0', '1.0', '0.9', '3.16', '2.55', '3.44',
        '3.2', '9.7', '5.7', '6.0', '5.97', '10.8', '2.77',
        '130', '140', '160', '170', '1.8', '2.7', '0.30', '0.48', '0.70', '4.74', '4.76',
        // 2回目の試走（一問一答）で足した: 生成エンタルピー CH₄ −75・Cl−Cl 243・蒸発 41／融解 6.0・溶解度（NaCl 38）・
        // ヘンリーの窒素 6.8×10⁻⁴・ベンゼンのモル凝固点降下 5.1・1気圧 760mmHg・炭素の原子量 12.01・CuSO₄ 160／CuSO₄·5H₂O 250
        '75', '243', '41', '44', '38', '6.8', '5.1', '0.51', '760', '12.01', '250']);
    const lib = docs.map(d => ({ name: d.name, text: d.text, pos: posIn(d.text) }));
    const SLIDES = arg('slides');
    const slideDocs = [];
    if (SLIDES && existsSync(SLIDES)) readdirSync(SLIDES).filter(n => /\.txt$/i.test(n)).forEach(n =>
        slideDocs.push({ name: n, text: norm(readFileSync(path.join(SLIDES, n), 'utf8')) }));
    slideDocs.forEach(d => { d.pos = posIn(d.text); });
    /* その数値の組が、どこかの文書の NUMWIN 字の中に NUMK 個以上そろうか。そろった所を返す */
    const together = (doc, nums) => {
        const occ = [];
        nums.forEach(n => (doc.pos.get(n) || []).forEach(p => occ.push({ n, p })));
        occ.sort((x, y) => x.p - y.p);
        let best = null;
        for (let i = 0, j = 0; i < occ.length; i++) {
            while (occ[i].p - occ[j].p > NUMWIN) j++;
            const set = new Set(occ.slice(j, i + 1).map(o => o.n));
            if (set.size >= Math.min(NUMK, nums.length) && (!best || set.size > best.set.size)) best = { set, at: occ[j].p };
        }
        return best;
    };
    const probs = [];
    if (args.includes('--qa')) {
        JSON.parse(readFileSync(path.join(ROOT, 'qa', 'questions.json'), 'utf8')).patterns.forEach(p =>
            (p.variants || []).forEach((v, k) => probs.push({ id: `${p.code}#${k + 1}`, text: v.q || '' })));
    } else {
        readdirSync(SRC).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).filter(id => !ONLY || id === ONLY).forEach(id =>
            readFileSync(path.join(SRC, id + '.md'), 'utf8').split(/\r?\n/).forEach((l, i) => {
                if (/^prompt:/.test(l)) probs.push({ id: `${id}:${i + 1}`, text: l.slice(7) });
            }));
    }
    const hits = [];
    probs.forEach(pr => {
        const nums = numsOf(pr.text);
        if (nums.length < 2) return;                       // 数値が1つだけの例題は数値で決め手にならない
        let top = null;
        lib.forEach(d => { const t = together(d, nums); if (t && (!top || t.set.size > top.set.size)) top = Object.assign({ doc: d }, t); });
        if (!top) return;
        const slide = slideDocs.find(d => { const t = together(d, [...top.set]); return t && t.set.size >= top.set.size; });
        const data = [...top.set].every(n => DATA.has(n));
        hits.push({ pr, nums, top, slide, data });
    });
    // 並び: ★ 文献とだけ一致 → 物性値だけ → スライドの数値
    const rank = h => h.slide ? 2 : h.data ? 1 : 0;
    hits.sort((a, b) => rank(a) - rank(b) || b.top.set.size - a.top.set.size);
    const own = hits.filter(h => rank(h) === 0).length, dat = hits.filter(h => rank(h) === 1).length;
    console.log(`文献 ${lib.length} 本・例題 ${probs.length} 問・数値が ${NUMK} 個以上そろう例題 ${hits.length} 問`
        + `（★ 文献とだけ一致 ${own}・物性値だけ ${dat}・スライドの数値 ${hits.length - own - dat}）`);
    hits.slice(0, Number(arg('show') || 60)).forEach(h => {
        const tag = ['★ 文献とだけ一致', '  物性値だけ', '  スライドの数値'][rank(h)];
        console.log(`${tag}  ${h.pr.id}  そろった数値 ${[...h.top.set].join('・')}（例題の数値 ${h.nums.join('・')}）← ${h.top.doc.name}` + (h.slide ? `（スライド: ${h.slide.name}）` : ''));
        console.log('      例題: ' + h.pr.text.slice(0, 90));
        console.log('      文献: ' + h.top.doc.text.slice(Math.max(0, h.top.at - 20), h.top.at + 90));
    });
    process.exit(0);
}
/* ★ --qa のときは一問一答（qa/questions.json）の文を1項目ずつ照らす（問い・答え・知識・肢・補足） */
const QA = args.includes('--qa');
const units = QA
    ? JSON.parse(readFileSync(path.join(ROOT, 'qa', 'questions.json'), 'utf8')).patterns.map(p => ({
        id: p.code,
        raw: [p.knowledge].concat(...(p.variants || []).map(v => [v.q, v.a, v.supplement].concat(v.options || []))).filter(Boolean).join(' ')
    }))
    : readdirSync(SRC).filter(n => n.endsWith('.md')).map(n => n.slice(0, -3)).filter(id => !ONLY || id === ONLY)
        .map(id => ({ id, raw: pageText(readFileSync(path.join(SRC, id + '.md'), 'utf8')) }));
const ids = units.map(u => u.id);
const found = [];
for (const u of units) {
    const id = u.id;
    const t = norm(u.raw);
    let i = 0;
    while (i + MIN <= t.length) {
        if (!seen.has(hash(t, i, MIN))) { i++; continue; }
        // 伸ばせるだけ伸ばす（文献の中に同じ並びがあるうちは）
        let j = i + MIN;
        const hit = s => docs.find(d => d.text.includes(s));
        let doc = hit(t.slice(i, j));
        if (!doc) { i++; continue; }   // ハッシュの衝突
        while (j < t.length && doc.text.includes(t.slice(i, j + 1))) j++;
        found.push({ id, len: j - i, doc: doc.name, text: t.slice(i, j) });
        i = j;
    }
}
/* ★ 化学式・定数・イオン化列のような「誰が書いても同じ並び」は外す: 日本語の字（かな・漢字）が JA 字未満の一致は数えない */
const JA = Number(arg('ja') || 12);
const jaCount = str => (str.match(/[぀-ヿ一-鿿]/g) || []).length;
for (let k = found.length - 1; k >= 0; k--) if (jaCount(found[k].text) < JA) found.splice(k, 1);
found.sort((a, b) => b.len - a.len);
console.log(`文献 ${docs.length} 本・原稿 ${ids.length} ページ・${MIN} 文字以上の一致 ${found.length} か所`);
const byPage = new Map();
found.forEach(f => byPage.set(f.id, (byPage.get(f.id) || 0) + 1));
console.log('ページごと: ' + [...byPage].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' / '));
found.slice(0, Number(arg('show') || 60)).forEach(f => console.log(`${String(f.len).padStart(3)}字  ${f.id}  ← ${f.doc}\n      ${f.text}`));
