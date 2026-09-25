/**
 * 未統合の一覧（Node で実行。ブラウザ不要・読み取りのみ）
 *
 *   node tools/triage-unmerged.js           … 一覧（セッションの始めに走らせる）
 *   node tools/triage-unmerged.js --deep    … 本体コードの「旧行が main に残るか」の目安も出す
 *   node tools/triage-unmerged.js --all     … 判定済み（tools/branch-verdicts.jsonl）も隠さない
 *
 * **なぜ要るか**（2026-09-19・調査で判明）: 完成・検証済みの直しがブランチに残ったまま
 * 統合されず、あとで同じ作業がやり直されていた（加硫・酸無水物・_cmpCarbonPath の二重タスク）。
 * レーンは自分の worktree で完結して upstream を持たないので、**コミットで止まり、
 * 完了報告はそのセッションのチャットの中にしか無い**。開き直さない限り誰の目にも触れない。
 * → 「main に入っていない仕事」を git から直接数えて、毎回画面に出す。
 *
 * 出すもの:
 *   A. **main に同じ差分が無いコミット**を持つブランチ（`git cherry` の `+`）
 *      —— 版番号などが違うだけの取り込み済みは `-` になるので数えない
 *   B. **コミット0件・未コミットあり**の worktree（レーンがコミット前に落ちた形。
 *      DEVELOPMENT.md「レーンは直したその場でコミットする」の節）
 *
 * ⚠ `git cherry` は「同じ差分が main にあるか」しか見ない。**別のやり方で直されたもの**は
 *   A に残り続ける。捨てるかどうかは DEVELOPMENT.md「放置された claude/* ブランチの棚卸し」
 *   （2026-08-13）の手順で1本ずつ決め、決めたら `tools/branch-verdicts.jsonl` に1行書く。
 *   ブランチは消さない（`git branch -D` は設定で拒否）。**判定は先端の SHA に結びつける**ので、
 *   判定のあとにコミットが積まれたブランチは一覧に戻ってくる。
 *
 * ★ ブランチと worktree の一覧はリポジトリ全体で共有なので、`verify-release.js` と違い
 *   **どの木の tools から呼んでも同じ結果**になる（嘘の合格の心配は無い）。
 *   判定台帳だけは「自分が置かれている木」のものを読む。
 *
 * 終了コード: 常に 0（情報を出すだけ。門番ではない）
 */
const fs = require('fs');
const path = require('path');
const { execFile, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const LEDGER = path.join(__dirname, 'branch-verdicts.jsonl');
const args = process.argv.slice(2);
const DEEP = args.includes('--deep');
const SHOW_ALL = args.includes('--all');
// ★ 基準は **origin/main**（公開されたもの）。本体の作業ツリーは複数セッションの共有で、
//   ローカルの main は隣のレーンの未 push のコミットを抱えたまま origin より何十件も遅れていることがある
//   （2026-09-19 実発生: ahead 2 / behind 56。統合した6本が「未統合」に見え、台帳も古いものを読んだ）。
//   origin/main は最後の git fetch の時点なので、正確に見たいときは先に fetch する
const BASE = git(['rev-parse', '--verify', '-q', 'origin/main']) ? 'origin/main' : 'main';

function git(argv, cwd = ROOT) {
    try {
        return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
    } catch (e) {
        return null;
    }
}
function gitAsync(argv, cwd) {
    return new Promise(res => execFile('git', argv, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 },
        (err, out) => res(err ? null : out)));
}
const lines = s => (s || '').split(/\r?\n/).filter(Boolean);
const days = unix => Math.floor((Date.now() / 1000 - unix) / 86400);

// --- 判定台帳（1行1件の JSON。{branch, sha, verdict, note, date}） ---
const verdicts = []; // {branch, sha(短縮可), verdict, note, date}
// 台帳は「自分の木」のものと「基準（origin/main）」のものを合わせて読む（どちらかにしか無い判定を落とさない）
const ledgerText = [fs.existsSync(LEDGER) ? fs.readFileSync(LEDGER, 'utf8') : '', git(['show', BASE + ':tools/branch-verdicts.jsonl']) || ''].join('\n');
{
    for (const [i, l] of lines(ledgerText).entries()) {
        try {
            const e = JSON.parse(l);
            if (e.branch && e.sha) verdicts.push(e);
        } catch (e) {
            console.error(`⚠ branch-verdicts.jsonl の行が JSON として読めません（飛ばします）: ${l.slice(0, 60)}`);
        }
    }
}
/* ★ 台帳の SHA がリポジトリに在るか（I-0145・2026-09-25）。
 *   9/21 の履歴の書き換えで SHA が全部変わり、判定済みの14本が黙って「未統合」に戻って見えた。
 *   次に書き換えたときに同じことが黙って起きないよう、引けない SHA を数えて出す（1回の cat-file でまとめて引く） */
{
    const uniq = [...new Set(verdicts.map(e => e.sha))];
    let out = null;
    try {
        out = execFileSync('git', ['cat-file', '--batch-check'], {
            cwd: ROOT, input: uniq.map(s => s + '^{commit}').join('\n') + '\n',
            encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 16 * 1024 * 1024
        });
    } catch (e) { out = null; }
    if (out) {
        const res = lines(out);
        const missingAll = uniq.filter((s, i) => / missing$/.test(res[i] || ''));
        /* ⚠ 数えるのは「今もあるブランチで、引ける SHA の判定が1行も無いもの」だけ ——
         *   書き換えのあとに新しい SHA で判定し直した行があれば、古い行は無害（14行が実際にそう） */
        const heads = new Set(lines(git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']) || ''));
        const okBranch = new Set(verdicts.filter(e => !missingAll.includes(e.sha)).map(e => e.branch));
        const stale = verdicts.filter(e => missingAll.includes(e.sha) && heads.has(e.branch) && !okBranch.has(e.branch));
        const missing = [...new Set(stale.map(e => e.sha))];
        if (missing.length) {
            const who = stale.map(e => e.branch);
            console.error(`⚠ branch-verdicts.jsonl の SHA のうち ${missing.length} 件がリポジトリに在りません（履歴の書き換えで変わった？）。` +
                `その判定は効かないので、ブランチが「未統合」に戻って見えます。判定し直して新しい SHA で1行足してください: ` +
                `${[...new Set(who)].slice(0, 5).join(', ')}${who.length > 5 ? ' …' : ''}`);
        }
    }
}
// 先端の SHA で引く ＝ 判定のあとにコミットが積まれたら、一覧に戻ってくる
const verdictOf = (branch, sha) => verdicts.find(e => e.branch === branch && sha.startsWith(e.sha)) || null;

// --- worktree の一覧（ブランチ → 置き場所） ---
const worktrees = [];
{
    let cur = null;
    for (const l of lines(git(['worktree', 'list', '--porcelain']))) {
        if (l.startsWith('worktree ')) { cur = { path: l.slice(9) }; worktrees.push(cur); }
        else if (cur && l.startsWith('branch ')) cur.branch = l.slice(7).replace(/^refs\/heads\//, '');
        else if (cur && l.startsWith('HEAD ')) cur.head = l.slice(5);
    }
}
const wtOf = new Map(worktrees.filter(w => w.branch).map(w => [w.branch, w]));

// --- ブランチの情報 ---
const info = new Map();
for (const l of lines(git(['for-each-ref', '--format=%(refname:short)\t%(objectname)\t%(committerdate:unix)\t%(subject)', 'refs/heads']))) {
    const [name, sha, unix, subject] = l.split('\t');
    info.set(name, { name, sha, unix: +unix, subject });
}

async function main() {
    const noMerged = lines(git(['branch', '--no-merged', BASE, '--format=%(refname:short)']));

    // A. main に同じ差分が無いコミットを持つブランチ（並列に数える）
    const rows = (await Promise.all(noMerged.map(async b => {
        const cherry = lines(await gitAsync(['cherry', BASE, b], ROOT));
        const unique = cherry.filter(l => l.startsWith('+')).length;
        if (!unique) return null;
        const r = { ...info.get(b), unique, ahead: cherry.length, wt: wtOf.get(b) || null };
        const mb = (await gitAsync(['merge-base', BASE, b], ROOT) || '').trim();
        const files = lines(await gitAsync(['diff', '--name-only', `${mb}..${b}`], ROOT));
        r.files = files.length;
        // main 側がその後、同じファイルを何回動かしたか（＝腐り具合。多いほど機械的に入れると危ない）
        r.mainMoved = files.length ? lines(await gitAsync(['rev-list', `${mb}..${BASE}`, '--', ...files.slice(0, 40)], ROOT)).length : 0;
        if (DEEP) Object.assign(r, residue(mb, b));
        return r;
    }))).filter(Boolean);

    // B. worktree の未コミット（本体の作業ツリーは除く ＝ scan/ など私物が常にある）
    const dirty = new Map();
    await Promise.all(worktrees.slice(1).map(async w => {
        if (!fs.existsSync(w.path)) return;
        // `.claude/launch.json` だけの変更はレーンがポートを足した跡（成果物ではない）なので数えない
        const ch = lines(await gitAsync(['status', '--porcelain', '-uno'], w.path))
            .map(l => l.slice(3)).filter(f => f !== '.claude/launch.json');
        if (ch.length) dirty.set(w.path, ch);
    }));

    const shown = [], hidden = [];
    for (const r of rows) (verdictOf(r.name, r.sha) && !SHOW_ALL ? hidden : shown).push(r);
    shown.sort((x, y) => x.unix - y.unix); // 古いものから（放置が長いほど上）

    const baseAge = (git(['log', '-1', '--format=%cr', BASE]) || '').trim();
    console.log(`基準: ${BASE}（最新のコミット ${baseAge}。古ければ先に git fetch）`);
    console.log(`■ ${BASE} に入っていない仕事（${shown.length} 本${hidden.length ? `・判定済み ${hidden.length} 本は隠した（--all で表示）` : ''}）`);
    if (!shown.length) console.log('  なし');
    else {
        console.log('  経過  独自  変更   main側  最終       ' + (DEEP ? '旧行残存 新行既存  ' : '') + 'ブランチ');
        console.log('  日数  Cm   ﾌｧｲﾙ   後続Cm  コミット日 ' + (DEEP ? '(本体コードのみ)   ' : ''));
        console.log('  ' + '─'.repeat(DEEP ? 104 : 86));
        for (const r of shown) {
            const d = new Date(r.unix * 1000);
            const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            const v = verdictOf(r.name, r.sha);
            const deep = DEEP ? `${pct(r.pDel, r.del)} ${pct(r.pAdd, r.add)}  ` : '';
            console.log(`  ${String(days(r.unix)).padStart(4)}  ${String(r.unique).padStart(3)}${r.ahead > r.unique ? '+' : ' '} ${String(r.files).padStart(4)}  ${String(r.mainMoved).padStart(6)}   ${date} ${deep}${r.name}`);
            const wt = r.wt ? `  [worktree ${r.wt.path}${dirty.has(r.wt.path) ? `・未コミット ${dirty.get(r.wt.path).length}` : ''}]` : '  [worktree なし]';
            console.log(`${' '.repeat(DEEP ? 56 : 38)}${r.subject.slice(0, 50)}${wt}${v ? `  〔判定: ${v.verdict}〕` : ''}`);
        }
        console.log('');
        console.log('  独自Cm の「+」: main に同じ差分があるコミット（取り込み済み）も混ざっている');
        console.log('  main側後続Cm: 分岐のあと main が同じファイルを動かした回数。多いほど古い土台（そのままマージすると巻き戻しうる）');
        if (DEEP) console.log('  旧行残存/新行既存: ブランチが消した/足した行が main にあるかの割合（目安。確定は足したテストを main に当てる）');
    }

    // B の表示: コミットが1つも無いのに未コミットがある worktree
    const orphan = worktrees.slice(1).filter(w => dirty.has(w.path) && !(w.branch && rows.some(r => r.name === w.branch)));
    console.log('');
    console.log(`■ コミットされていない変更がある worktree（${orphan.length} 本）`);
    if (!orphan.length) console.log('  なし');
    for (const w of orphan) {
        const b = w.branch ? info.get(w.branch) : null;
        const ch = dirty.get(w.path);
        const when = b ? `最終Cm ${days(b.unix)}日前` : '';
        console.log(`  ${String(ch.length).padStart(3)}件  ${(w.branch || '(detached)').padEnd(34)} ${when.padStart(13)}  ${w.path}`);
        console.log(`        ${ch.slice(0, 3).join('  ')}${ch.length > 3 ? `  …ほか ${ch.length - 3}` : ''}`);
    }
    console.log('');
    console.log('捨てる・取り込み済みと決めたら tools/branch-verdicts.jsonl に1行書く（DEVELOPMENT.md「未統合の一覧」の節）。');
}

// --- --deep: ブランチが消した行・足した行が main に在るか（本体コードだけ・目安） ---
const IS_SRC = f => /\.(js|mjs|html|css)$/.test(f) && !/tests?\.(js|html)$|audit\.|\/record\//.test(f);
const TRIVIAL = /^\s*$|v\d{3,4}|\?v=\d+|^\s*[{}\[\](),;]+\s*$|^\s*\/\/|^\s*\*|^\s*\/\*/;
const mainFiles = new Map();
function residue(mb, b) {
    const diff = git(['diff', '--unified=0', mb, b]) || '';
    let file = null, del = 0, delStill = 0, add = 0, addHave = 0;
    for (const line of diff.split(/\r?\n/)) {
        if (line.startsWith('+++ ')) { file = line.startsWith('+++ b/') ? line.slice(6) : null; continue; }
        if (line.startsWith('--- ') || !file || !IS_SRC(file)) continue;
        if (line[0] !== '-' && line[0] !== '+') continue;
        const body = line.slice(1).trim();
        if (TRIVIAL.test(body) || body.length < 12) continue;
        if (!mainFiles.has(file)) mainFiles.set(file, git(['show', `${BASE}:${file}`]));
        const src = mainFiles.get(file);
        if (line[0] === '-') { del++; if (src && src.includes(body)) delStill++; }
        else { add++; if (src && src.includes(body)) addHave++; }
    }
    return { del, add, pDel: del ? Math.round(delStill / del * 100) : null, pAdd: add ? Math.round(addHave / add * 100) : null };
}
const pct = (p, n) => (p === null || p === undefined ? '    -    ' : `${String(p).padStart(3)}%(${String(n).padStart(3)})`);

main();
