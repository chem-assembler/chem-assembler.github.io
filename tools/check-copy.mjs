/**
 * 参考書の原稿が、参考にした文献の文章の**写し**になっていないかを調べる（2026-09-23・ユーザー
 * 「参考にした文献の文章のコピーになっていないか検査する必要がある」）。
 *
 *   node tools/check-copy.mjs --corpus=<文献の文字のフォルダ> [--min=20] [--ja=12] [--page=<id>] [--show=60]
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
