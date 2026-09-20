/**
 * 会話の中の「あとで・保留・宿題」を拾い、**課題台帳に無いもの**を出す（月1回）
 *
 *   node tools/promise-scan.js                       … 前回からの差分（状態は下の --state）
 *   node tools/promise-scan.js --since=2026-09-21    … 日付を指定
 *   node tools/promise-scan.js --all                 … 全期間（初回の棚卸し用・重い）
 *   node tools/promise-scan.js --out=<path>          … 書き出し先（既定は STATUS/archive/…）
 *
 * ★ **なぜ要るか**（2026-09-21 の棚卸し）: 会話の中だけで決まった仕事は、ブランチにもファイルにも
 *   ならないので、`triage-unmerged.js`（コミット）にも `verify-release.js`（文書）にも映らない。
 *   実測では 7/30〜9/20 の 1,112件のうち **17件がどこにも残っていなかった**。
 *   取りこぼし率は 8月 1.1% → 9/1〜18 **3.5%** と**上がっていた**（下がっていなかった）。
 *
 * ⚠ **これは「見つける」道具で、「直す」道具ではない。** 出てきた行は人が見て、
 *   台帳へ足すか `skip` と判断する。⚠ 会話の記録はユーザーの私的な作業記録なので、
 *   **書き出し先はリポジトリの外**（既定は `STATUS/archive/promise-scan/`）。
 *
 * 読む場所: `~/.claude/projects/<プロジェクト>/*.jsonl`（本体のセッションのみ。
 * サブエージェント＝レーンの発言は「約束」ではなく作業報告なので見ない）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const PROJ = 'C--Users-maequ--------Antigravity-OrganicChemistryPuzzle';
const TRANSCRIPTS = path.join(os.homedir(), '.claude', 'projects', PROJ);
const STATUS = path.join(os.homedir(), 'マイドライブ', 'Antigravity', 'STATUS');
const STATE = path.join(STATUS, 'archive', 'promise-scan', 'state.json');

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const all = process.argv.includes('--all');

// 「これからやる」と読める言い回しだけに絞る（報告・一般論は落とす）
const WANT = /(あとで|後で|後回し|保留|次の便で|いずれ|そのうち|宿題|TODO|未着手|未実装|積み残)/;
const DROP = /(漢文|返り点|KokugoLens|InfoLens|GradeLens|Supabase|ポータル|Focus Gold)/;
const DONE = /^(✅|済み|できました|終わりました|入れました|直しました|公開しました)/;

function readLines(file) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(1 << 24);
    let rest = Buffer.alloc(0), n;
    const out = [];
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) {
        let ch = Buffer.concat([rest, buf.subarray(0, n)]);
        let st = 0, i;
        while ((i = ch.indexOf(10, st)) >= 0) { const l = ch.subarray(st, i); st = i + 1; if (l.length < 3e7) out.push(l.toString('utf8')); }
        rest = ch.subarray(st);
    }
    fs.closeSync(fd);
    return out;
}

const since = all ? '0000-00-00'
    : arg('since', (fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')).last : null)
        || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));

if (!fs.existsSync(TRANSCRIPTS)) { console.log(`会話の記録が見つかりません: ${TRANSCRIPTS}`); process.exit(1); }

const rows = [];
let newest = since;
for (const f of fs.readdirSync(TRANSCRIPTS)) {
    if (!f.endsWith('.jsonl')) continue;                 // 本体のセッションだけ（サブエージェントは配下の別フォルダ）
    let lastUser = '';
    for (const ln of readLines(path.join(TRANSCRIPTS, f))) {
        if (!WANT.test(ln)) continue;
        let r; try { r = JSON.parse(ln); } catch { continue; }
        const date = (r.timestamp || '').slice(0, 10);
        if (!date || date < since) continue;
        if (date > newest) newest = date;
        if (r.type === 'user' && typeof r.message?.content === 'string') { lastUser = r.message.content.replace(/\s+/g, ' ').slice(0, 160); continue; }
        if (r.type !== 'assistant') continue;
        const text = (r.message?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
        for (const raw of text.split('\n')) {
            const line = raw.trim();
            if (line.length < 14 || line.length > 160) continue;
            if (!WANT.test(line) || DROP.test(line) || DONE.test(line)) continue;
            rows.push({ date, user_before: lastUser, line });
        }
    }
}

// 文面の重複を畳む
const seen = new Map();
rows.forEach(r => { const k = r.line.replace(/[0-9]+/g, '#').slice(0, 60); if (!seen.has(k)) seen.set(k, r); });
const uniq = [...seen.values()].sort((a, b) => a.date.localeCompare(b.date));

// 台帳に載っていそうなものを落とす（題名・根拠の語が行に出ていれば「載っている」とみなす）
const ledgerPath = path.join(ROOT, 'tools', 'issues.jsonl');
const ledger = fs.existsSync(ledgerPath)
    ? fs.readFileSync(ledgerPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const words = ledger.flatMap(r => String(r.title).split(/[ 　（）()・、。/]+/).filter(w => w.length >= 4));
const already = (line) => /\bI-\d{4}\b/.test(line) || words.some(w => line.includes(w));
const candidates = uniq.filter(r => !already(r.line));

const outDir = arg('out', path.join(STATUS, 'archive', 'promise-scan'));
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 10);
const outFile = path.join(outDir, `candidates-${stamp}.jsonl`);
fs.writeFileSync(outFile, candidates.map((r, i) => JSON.stringify({ no: i + 1, ...r })).join('\n') + '\n', 'utf8');
fs.mkdirSync(path.dirname(STATE), { recursive: true });
fs.writeFileSync(STATE, JSON.stringify({ last: newest, ran: stamp, candidates: candidates.length }, null, 1) + '\n', 'utf8');

console.log(`${since} 以降の会話から ${uniq.length} 行（重複を畳んだ後）。`);
console.log(`台帳に載っていそうなものを除いた候補: ${candidates.length} 行 → ${outFile}`);
console.log('★ 1件ずつ見て、仕事なら台帳へ（node tools/issues.js add --area=… --title=…）、そうでなければ何もしない。');
console.log('⚠ 候補が多い月は「書いた場所が増えた」合図。受け皿を増やしていないか疑うこと。');
