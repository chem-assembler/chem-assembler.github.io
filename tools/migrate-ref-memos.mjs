/**
 * 原稿（reference-src/*.md）の著者メモのうち、**器ができるまでの仮置き**を本物の書式へ移す（便0a・2026-09-19）。
 *
 *   node tools/migrate-ref-memos.mjs                 … 見るだけ（何をどう直すかを1件ずつ出す。書き換えない）
 *   node tools/migrate-ref-memos.mjs --write         … 書き換える
 *   node tools/migrate-ref-memos.mjs halogen ph      … そのページだけ
 *
 * ★ 移すメモは3種類（発注書のひな形 §3-5・§4-2 ⑨・§5 の書き方）:
 *
 *   ① `//app: ion-equation/redox rxn=rs1 「過マンガン酸カリウムと鉄(Ⅱ)イオンの反応式を組み立てる」`
 *        → :::link（app: / id: / text:）を、メモのあった段落・囲みの**直後**に置く
 *        ★ 受け口は名前（`ion-equation/redox`）でも URL（`/ion-equation/redox.html?rxn=rs1`・`portal.html#u-gas`）でもよい
 *          ＝ 台帳（tools/reference-md.js の APP_TARGETS）で名前に引き直す。id は `rxn=rs1`・`#u-gas`・素の `rs1` のどれでも
 *        ⚠ 「」の中が押す文（text:）。6字未満・無し・台帳に無い受け口は**移さずに残して**一覧に出す
 *   ② `//⇄`（`:::reaction` の中か直後）→ その式に `arrow: ⇄` を足し、note の「（可逆）」を消す
 *   ③ `//撮影: url=… sel=… 状態=…`（`:::figure` の中か直後）→ その図に `shot: url=… sel=… 状態=…` を足す
 *        ⚠ src が `<ページid>-app-<中身>.png` でなければ書式が赤にする（移したあと gen-reference.mjs で分かる）
 *
 * ⚠ 移したあとは必ず `node tools/gen-reference.mjs`（書式の検査と生成）。③ を移したら
 *   `node tools/gen-app-figure.mjs --port=<ポート> <ページid>` で撮る。
 * ⚠ 改行は元のファイルに合わせる（CRLF のまま書き戻す）。メモ以外の行は1文字も触らない。
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'reference-src');
const RM = require('./reference-md.js');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const ONLY = args.filter(a => !a.startsWith('--'));

/* メモを抜く正規表現は書式（parsePage）と同じ形: `//` の直前が行頭か `:` `/` 以外 */
const MEMO_RE = /(^|[^:\/])\/\/(.*)$/;

/** 受け口の指定（名前か URL）と id を台帳の名前へ引き直す */
function resolveApp(spec) {
    const T = RM.APP_TARGETS;
    let s = spec.trim(), idTok = '';
    const sp = s.split(/\s+/);
    s = sp[0]; idTok = sp.slice(1).join(' ');
    let name = null, id = '';
    if (Object.prototype.hasOwnProperty.call(T, s)) name = s;
    else {
        // URL の形（先頭の / は無くてもよい・ion-equation/ を省いた portal.html#… も受ける）
        const m = /^\/?([^?#]*?)(\?[^#]*)?(#.*)?$/.exec(s);
        let p = '/' + m[1].replace(/^\//, '');
        if (!/^\/(ion-equation|muki|ratio)\//.test(p)) p = '/ion-equation/' + p.replace(/^\//, '');
        const cands = Object.keys(T).filter(k => T[k].path === p || T[k].path === p + '/' || (T[k].path.endsWith('/') && p === T[k].path + 'index.html'));
        if (cands.length) {
            name = cands[0];
            const t = T[name];
            if (t.param === '#' && m[3]) id = m[3].slice(1);
            else if (t.param && m[2]) id = new URLSearchParams(m[2]).get(t.param) || '';
        }
    }
    if (!name) return null;
    const t = T[name];
    if (idTok) {
        const k = /^([A-Za-z]+)=(.+)$/.exec(idTok);
        if (k) id = k[2];
        else if (idTok.startsWith('#')) id = idTok.slice(1);
        else id = idTok;
        if (k && t.param && t.param !== '#' && k[1] !== t.param) return { error: `「${name}」の引数は ${t.param}= です（${k[1]}= と書いてある）` };
    }
    return { name, id };
}

/** 行の配列から囲み（:::）の範囲を拾う。[{ start, end, kind }] */
function fences(lines) {
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const m = /^:::([A-Za-z][A-Za-z0-9]*)?/.exec(lines[i]);
        if (!m) continue;
        const rest = lines[i].replace(/^:::([A-Za-z][A-Za-z0-9]*)?/, '');
        if (/:::\s*$/.test(rest)) { out.push({ start: i, end: i, kind: m[1] || '' }); continue; }
        let j = i + 1;
        while (j < lines.length && !(lines[j].trim() === ':::' || /:::\s*$/.test(lines[j]))) j++;
        out.push({ start: i, end: j, kind: m[1] || '' });
        i = j;
    }
    return out;
}

/** その行が属する囲み、または直前（空行だけを挟んで）の囲み */
function hostFence(fs, lines, at, kind) {
    const inside = fs.find(f => f.start <= at && at <= f.end);
    if (inside) return inside.kind === kind ? inside : null;
    let k = at - 1;
    while (k >= 0 && lines[k].trim() === '') k--;
    const prev = fs.find(f => f.end === k);
    return prev && prev.kind === kind ? prev : null;
}

/** 段落・囲みの終わり（次の空行の手前）。囲みの中ならその囲みの終わり */
function blockEnd(fs, lines, at) {
    const inside = fs.find(f => f.start <= at && at <= f.end);
    if (inside) return inside.end;
    let k = at;
    while (k + 1 < lines.length && lines[k + 1].trim() !== '') k++;
    return k;
}

function migrate(id, text) {
    const eol = text.includes('\r\n') ? '\r\n' : '\n';
    const lines = text.replace(/\r\n/g, '\n').split('\n');
    /* ⚠ 囲みの範囲はメモを抜いた行で拾う（`::: //⇄` の行末は `:::` で閉じている） */
    const bare = lines.map(l => { const mm = MEMO_RE.exec(l); return mm ? l.slice(0, mm.index + mm[1].length).replace(/\s+$/, '') : l; });
    const fs = fences(bare);
    const edits = [];      // { at, kind, ... }
    const left = [];       // 移せなかったもの
    lines.forEach((line, i) => {
        const m = MEMO_RE.exec(line);
        if (!m) return;
        const body = m[2].trim();
        const strip = () => line.slice(0, m.index + m[1].length).replace(/\s+$/, '');
        if (/^app:/.test(body)) {
            const am = /^app:\s*(.*?)\s*「([^」]*)」\s*$/.exec(body);
            if (!am) { left.push(`${id}.md:${i + 1} ${body}（「押す文」が「」で括られていない）`); return; }
            const r = resolveApp(am[1]);
            if (!r || r.error) { left.push(`${id}.md:${i + 1} ${body}（${r ? r.error : '受け口の台帳に無い'}）`); return; }
            const t = RM.APP_TARGETS[r.name];
            if (t.param && !t.opt && !r.id) { left.push(`${id}.md:${i + 1} ${body}（${r.name} には id が要る）`); return; }
            if (!t.param && r.id) { left.push(`${id}.md:${i + 1} ${body}（${r.name} は id を取らない）`); return; }
            if (am[2].trim().length < 6) { left.push(`${id}.md:${i + 1} ${body}（押す文が6字未満。何をしに行くリンクかが分かる文にする）`); return; }
            const blk = [':::link', 'app: ' + r.name].concat(r.id ? ['id: ' + r.id] : []).concat(['text: ' + am[2].trim(), ':::']);
            edits.push({ at: i, kind: 'app', strip: strip(), blk, after: blockEnd(fs, lines, i) });
        } else if (/^⇄/.test(body)) {
            const f = hostFence(fs, lines, i, 'reaction');
            if (!f) { left.push(`${id}.md:${i + 1} //⇄（:::reaction の中にも直後にも無い）`); return; }
            edits.push({ at: i, kind: 'arrow', strip: strip(), fence: f });
        } else if (/^撮影:/.test(body)) {
            const f = hostFence(fs, lines, i, 'figure');
            if (!f) { left.push(`${id}.md:${i + 1} ${body}（:::figure の中にも直後にも無い）`); return; }
            edits.push({ at: i, kind: 'shot', strip: strip(), fence: f, shot: body.replace(/^撮影:\s*/, '') });
        }
    });
    if (!edits.length) return { text, edits, left };

    /* ① 行の中身を直す（後ろから挿入するので、まず置き換えだけ） */
    const out = lines.slice();
    const inserts = [];   // { after, lines }
    const drop = new Set();
    edits.forEach(e => {
        out[e.at] = e.strip;
        if (e.strip.trim() === '' && !fs.some(f => f.start <= e.at && e.at <= f.end)) drop.add(e.at);
        if (e.kind === 'app') {
            inserts.push({ after: e.after, lines: [''].concat(e.blk), seq: e.at });
        } else if (e.kind === 'arrow') {
            const f = e.fence;
            if (f.start === f.end) {
                out[f.start] = out[f.start].replace(/(\s)right:/, '$1arrow: ⇄ right:').replace(/\s*（可逆）/, '').replace(/\s+note:\s*(?=:::\s*$)/, ' ');
            } else {
                for (let k = f.start; k <= f.end; k++) {
                    /* ⚠ 「note: （可逆）…」の「note:」の後ろの空白は残す */
                    if (/^\s*note:/.test(out[k])) out[k] = out[k].replace(/\s*（可逆）\s*/, ' ').replace(/^(\s*note:)\s*/, '$1 ').replace(/\s+$/, '');
                    if (/^\s*note:\s*$/.test(out[k])) drop.add(k);
                }
                const r = out.findIndex((l, k) => k >= f.start && k <= f.end && /^\s*right:/.test(l));
                inserts.push({ after: r >= 0 ? r - 1 : f.start, lines: ['arrow: ⇄'] });
            }
        } else if (e.kind === 'shot') {
            const f = e.fence;
            const s = out.findIndex((l, k) => k >= f.start && k <= f.end && /^(:::figure\s+)?\s*src:/.test(l));
            if (f.start === f.end || s < 0) { left.push(`${id}.md:${e.at + 1} //撮影（1行に詰めた :::figure には入れない。手で shot: を足す）`); out[e.at] = lines[e.at]; drop.delete(e.at); return; }
            inserts.push({ after: s, lines: ['shot: ' + e.shot] });
        }
    });
    /* ⚠ 同じ段落の後ろに複数のリンクを置くときは、メモの順を保つ（後ろのメモから先に差し込む。
         同順位のまま splice すると、3本並んだ //app: が逆順の :::link になっていた） */
    inserts.sort((a, b) => b.after - a.after || (b.seq || 0) - (a.seq || 0)).forEach(ins => out.splice(ins.after + 1, 0, ...ins.lines));
    // 空になったメモだけの行を落とす（挿入で番号がずれるので、中身の一致で落とす）
    const res = [];
    const keepIdx = new Set();
    out.forEach((l, k) => keepIdx.add(k));
    // drop は挿入前の番号 → 挿入後の番号へ写す
    const shift = (n) => n + inserts.filter(ins => ins.after < n).reduce((s, ins) => s + ins.lines.length, 0);
    const dropped = new Set([...drop].map(shift));
    out.forEach((l, k) => { if (!dropped.has(k)) res.push(l); });
    // 空行が3つ以上続いたら2つに（メモの行を落とした跡）
    const txt = res.join('\n').replace(/\n{3,}/g, '\n\n');
    return { text: txt.replace(/\n/g, eol), edits, left };
}

const files = readdirSync(SRC).filter(f => f.endsWith('.md'))
    .filter(f => !ONLY.length || ONLY.includes(f.replace(/\.md$/, '')));
let nEdit = 0, nLeft = 0;
files.forEach(f => {
    const id = f.replace(/\.md$/, '');
    const p = path.join(SRC, f);
    const before = readFileSync(p, 'utf8');
    const r = migrate(id, before);
    if (!r.edits.length && !r.left.length) return;
    console.log(`\n📄 reference-src/${f}`);
    r.edits.forEach(e => console.log(`   ${e.at + 1}行  ${e.kind === 'app' ? ':::link ' + e.blk.slice(1, -1).join(' / ') : e.kind === 'arrow' ? 'arrow: ⇄' : 'shot: ' + e.shot}`));
    r.left.forEach(s => console.log(`   ⚠ 移せない: ${s}`));
    nEdit += r.edits.length; nLeft += r.left.length;
    if (WRITE && r.text !== before) writeFileSync(p, r.text, 'utf8');
});
console.log(`\n${WRITE ? '✅ 移しました' : '（見るだけ。--write で書き換えます）'}: ${nEdit} 件` + (nLeft ? ` ／ ⚠ 移せないもの ${nLeft} 件（手で直す）` : ''));
if (WRITE && nEdit) console.log('   ⚠ 続けて node tools/gen-reference.mjs（書式の検査と生成）を走らせてください');
