/**
 * 課題台帳（`tools/issues.jsonl`）を扱う道具
 *
 *   node tools/issues.js list [--state=open] [--area=assembler]   … 一覧
 *   node tools/issues.js find <語> [<語>…]                        … 語で引く（着手の前に必ず引く）
 *   node tools/issues.js show I-0007                              … 1件
 *   node tools/issues.js check                                    … 形と重複の検査（CI が呼ぶ）
 *   node tools/issues.js baseline                                 … 規則12 の基準を取り直す
 *
 * ★ **なぜ台帳を1本にするか**（2026-09-21・会話の棚卸しの結果）
 * 7/30〜9/20 の会話から「あとで・保留・宿題」の行 1,112件を調べたところ、**17件がどこにも
 * 残っていなかった**（`STATUS/archive/2026-09-21-棚卸し/結果-言ったのに残っていない仕事.md`）。
 * うち11件は「設計書・発注書・コード内コメントにだけ書いた」型。受け皿が7つ（DEVELOPMENT.md・
 * 各 DESIGN_*.md・動画の発注書・QUEUE.md・docs/・STATUS・メモ）あり、**どこに書いても
 * 「書いた」ことになるので、書き手は満足し、読み手は見つけられない。**
 *
 * ⚠ **同じ件が別の言葉で何度も出るのが、いちばん高くつく。** 実測では D-1/D-2/D-3 が3〜4回、
 * 絞り込みの順の調査が3回、会話に現れている。加硫の直しは2回行われ、酸無水物は回避策と
 * 本修正が別々に作られた。**前に決めたことを見つけられないから、また議論して、また作る。**
 *
 * ★ だから台帳は「もう1つの受け皿」ではなく、**id で引ける1本の索引**にする:
 *   - 役割の分け方 … STATUS＝現在地の物語 ／ DEVELOPMENT.md・DESIGN＝方針 ／ **この台帳＝仕事の一覧**
 *   - 機械で守る … `verify-release.js` の規則12 が「文書に『未着手・保留・あとで』と書くなら id を添える」を求める
 *   - 二重対処を止める … コミットの本文に `I-0042` を書く。`git log --grep=I-0042` で前の試みが引ける
 *
 * ⚠ **公開リポジトリに置く。** 就業上の制約・収益の話など、公開できないものは台帳に書かず
 *   `STATUS/` 側に置くこと（CLAUDE.md・memory の方針）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const LEDGER = path.join(ROOT, 'tools', 'issues.jsonl');
const BASELINE = path.join(ROOT, 'tools', 'issues-baseline.json');

const STATES = ['open', 'doing', 'blocked', 'done', 'dropped'];
const AREAS = ['assembler', 'qa', 'ion-equation', 'ratio', 'muki', '参考書', '入試DB', '動画', '道具', '横断'];

function load() {
    if (!fs.existsSync(LEDGER)) return [];
    return fs.readFileSync(LEDGER, 'utf8').split('\n').filter(l => l.trim()).map((l, i) => {
        try { return JSON.parse(l); } catch (e) { throw new Error(`${LEDGER}:${i + 1} が JSON として読めません`); }
    });
}

// 1行1件で書き戻す（compounds.json と同じ考え方＝差分が「足した件数」になる）
function save(rows) {
    // 改行は CRLF（リポジトリの規約。core.autocrlf=true なので LF で書くと次の checkout で全行が差分になる）
    fs.writeFileSync(LEDGER, rows.map(r => JSON.stringify(r)).join('\r\n') + '\r\n', 'utf8');
}

const nextId = (rows) => 'I-' + String(rows.reduce((m, r) => Math.max(m, Number(String(r.id).slice(2)) || 0), 0) + 1).padStart(4, '0');

const fmt = (r) => `${r.id} [${r.state}] ${r.area}: ${r.title}`
    + (r.owner ? `  （担当 ${r.owner}）` : '')
    + (r.dup_of ? `  ← ${r.dup_of} と同じ` : '');

// ---- 検査（CI が呼ぶ）----------------------------------------------------
function check() {
    const rows = load();
    const bad = [];
    const seen = new Set();
    rows.forEach((r, i) => {
        const at = `${i + 1}行目`;
        if (!/^I-\d{4}$/.test(r.id || '')) bad.push(`${at}: id が I-#### の形でない（${r.id}）`);
        if (seen.has(r.id)) bad.push(`${at}: id が重複（${r.id}）`);
        seen.add(r.id);
        if (!r.title || r.title.length < 6) bad.push(`${r.id}: title が短すぎる`);
        if (!STATES.includes(r.state)) bad.push(`${r.id}: state が ${STATES.join('/')} でない（${r.state}）`);
        if (!AREAS.includes(r.area)) bad.push(`${r.id}: area が ${AREAS.join('/')} でない（${r.area}）`);
        if (r.state === 'dropped' && !r.note) bad.push(`${r.id}: 捨てるなら理由を note に書く`);
        if (r.dup_of && !rows.some(x => x.id === r.dup_of)) bad.push(`${r.id}: dup_of の ${r.dup_of} が台帳に無い`);
    });
    if (bad.length) {
        console.log(`❌ 台帳に ${bad.length} 件の問題:`);
        bad.forEach(b => console.log('  - ' + b));
        process.exit(1);
    }
    const by = {};
    rows.forEach(r => by[r.state] = (by[r.state] || 0) + 1);
    console.log(`✅ 課題台帳 ${rows.length} 件（${Object.entries(by).map(([k, v]) => k + ' ' + v).join(' / ')}）`);
}

// ---- 規則12 の基準（いま文書に残っている「未着手・保留」を既知として控える）----
const PROMISE = /(未着手|未実装|保留|あとで|後で|後回し|TODO|積み残)/;
const ID = /\bI-\d{4}\b/;
// 見る範囲: リポジトリ直下の方針・設計の文書と、参考書の原稿
function docFiles() {
    const out = [];
    fs.readdirSync(ROOT).filter(f => /^(DEVELOPMENT|DESIGN_|SNS_|SEO_|CLAUDE).*\.md$/.test(f)).forEach(f => out.push(f));
    ['reference-src', 'video-scripts'].forEach(dir => {
        const d = path.join(ROOT, dir);
        if (!fs.existsSync(d)) return;
        fs.readdirSync(d).filter(f => f.endsWith('.md')).forEach(f => out.push(`${dir}/${f}`));
    });
    return out;
}
const key = (rel, line) => require('crypto').createHash('sha1').update(rel + '|' + line.trim()).digest('hex').slice(0, 12);

// ⚠ **この仕掛け自身を説明している行は見ない**（台帳・規則12・道具の名前が出る行）。
//   でないと「書きっぱなしを止める仕組み」の説明文が毎回赤くなる（2026-09-21 に実際に起きた）。
// ⚠ コードの囲み（```）の中も見ない —— 使い方の例に語が出るのは当たり前
const SELF = /(課題台帳|台帳|規則12|issues\.js|issues\.jsonl|promise-scan|棚卸し)/;
function scanDocs() {
    const hits = [];
    docFiles().forEach(rel => {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) return;
        let fence = false;
        fs.readFileSync(abs, 'utf8').split(/\r?\n/).forEach((line, i) => {
            if (/^\s*```/.test(line)) { fence = !fence; return; }
            if (fence) return;
            if (!PROMISE.test(line) || ID.test(line) || SELF.test(line)) return;
            hits.push({ rel, no: i + 1, line: line.trim(), key: key(rel, line) });
        });
    });
    return hits;
}

function baseline() {
    const hits = scanDocs();
    fs.writeFileSync(BASELINE, JSON.stringify({
        note: 'verify-release.js 規則12 の基準。ここに載っている行は「台帳を作る前からあった書きっぱなし」として見逃す。'
            + '新しく書いた行は I-#### を添えること。基準を取り直すのは、載っている行を台帳へ移し終えたときだけ。',
        made: new Date().toISOString().slice(0, 10),
        keys: hits.map(h => h.key).sort()
    }, null, 1) + '\n', 'utf8');
    console.log(`規則12 の基準を取り直しました: ${hits.length} 行（${new Set(hits.map(h => h.rel)).size} ファイル）`);
}

// ---- 入口 ---------------------------------------------------------------
const cmd = process.argv[2];
const args = process.argv.slice(3);
const rows = cmd === 'add' || cmd === 'list' || cmd === 'find' || cmd === 'show' ? load() : null;

if (cmd === 'list') {
    const st = (args.find(a => a.startsWith('--state=')) || '').split('=')[1];
    const ar = (args.find(a => a.startsWith('--area=')) || '').split('=')[1];
    const sel = rows.filter(r => (!st || r.state === st) && (!ar || r.area === ar));
    sel.forEach(r => console.log(fmt(r)));
    console.log(`—— ${sel.length} 件 / 全 ${rows.length} 件`);
} else if (cmd === 'find') {
    if (!args.length) { console.log('語を渡してください'); process.exit(1); }
    const sel = rows.filter(r => args.some(w => JSON.stringify(r).includes(w)));
    sel.forEach(r => { console.log(fmt(r)); if (r.evidence) console.log('      ' + [].concat(r.evidence).join(' / ')); });
    console.log(sel.length ? `—— ${sel.length} 件。**同じ件なら新しく作らず、この id で続けること**`
        : '—— 0 件。台帳に無いので、新しく足してよい（node tools/issues.js add …）');
} else if (cmd === 'show') {
    const r = rows.find(x => x.id === args[0]);
    if (!r) { console.log(`${args[0]} は台帳にありません`); process.exit(1); }
    console.log(JSON.stringify(r, null, 1));
} else if (cmd === 'add') {
    const get = (k, d) => { const a = args.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
    const r = {
        id: nextId(rows), area: get('area', '横断'), title: get('title', ''), state: get('state', 'open'),
        owner: get('owner', ''), evidence: get('evidence', '') ? get('evidence', '').split(',') : [],
        source: get('source', ''), note: get('note', ''), dup_of: get('dup', '') || null,
        added: new Date().toISOString().slice(0, 10)
    };
    if (!r.title) { console.log('--title= が要ります'); process.exit(1); }
    save(rows.concat([r]));
    console.log('足しました: ' + fmt(r));
} else if (cmd === 'check') {
    check();
} else if (cmd === 'baseline') {
    baseline();
} else if (cmd === 'scan') {
    const b = fs.existsSync(BASELINE) ? new Set(JSON.parse(fs.readFileSync(BASELINE, 'utf8')).keys) : new Set();
    const now = scanDocs().filter(h => !b.has(h.key));
    now.forEach(h => console.log(`${h.rel}:${h.no}  ${h.line.slice(0, 100)}`));
    console.log(`—— 基準に無い「書きっぱなし」 ${now.length} 行`);
} else {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').replace(/^ \* ?/gm, ''));
}
