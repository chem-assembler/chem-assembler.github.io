/**
 * 公開前のリリース検査（Node で実行。ブラウザ不要）
 *
 *   node tools/verify-release.js            … 全アプリ（assembler / ion-equation / ratio …）
 *   node tools/verify-release.js assembler  … アプリを1つに絞る
 *
 * CLAUDE.md の「コミット前の儀式」のうち、これまで**人が覚えているだけだった**2つ
 * ——キャッシュバスター `?v=NN` の一括更新と、文字化けパターンの確認——を機械化する。
 * どちらも忘れても画面上はいちおう動くため、テストでは落ちない。落ちないまま
 * 「古い JS がキャッシュから配られる」「文字化けしたまま公開される」ことが起きうる。
 *
 * 検査項目:
 *   1. アプリ内の `?v=NN` がすべて同じ番号か（1ファイルだけ上げ忘れる事故を止める）
 *   2. `<div class="version">vNN</div>` の表示が `?v=NN` と一致するか
 *   3. `?v=` を付けて読み込んでいるファイルが実在するか（改名・削除による死にリンク）
 *   4. ローカルの js/css/json を `?v=` なしで読み込んでいないか（そのファイルだけ永久に
 *      キャッシュされ続ける。新規ファイルを足したときに起きやすい）
 *   5. **変更があるのに版を上げていないか**（git と比較。これが本命の検査）
 *   6. 文字化けパターンが混入していないか（過去に実際の事故あり）
 *   7. UTF-8 の BOM が付いていないか
 *   8. **これから push するコミットで、触ったアプリの版が上がっているか**（規則5の死角を塞ぐ）
 *
 * 終了コード 0 = 合格、1 = 問題あり
 *
 * 注意: ルート index.html（化学レンズのハブ）は自己完結で外部アセットを持たないため、
 * `?v=` の対象外＝アプリとして扱わない（CLAUDE.md の方針どおり）。
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const only = process.argv[2] || null;

const problems = [];
const warnings = [];

// --- git 補助（git が無くても他の検査は動くようにする） ---
function git(cmd) {
    try {
        return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (e) {
        return null;
    }
}
const tracked = (git('ls-files') || '').split('\n').map(s => s.trim()).filter(Boolean);
const hasGit = tracked.length > 0;
if (!hasGit) warnings.push('git が使えないため、追跡ファイルの一覧と「版を上げ忘れ」の検査を飛ばします');

// ---------------------------------------------------------------
// アプリの割り出し: `?v=` を含む html があるディレクトリをアプリとみなす
// ---------------------------------------------------------------
const V_RE = /\?v=(\d+)/g;
const htmlFiles = (hasGit ? tracked.filter(f => f.endsWith('.html'))
    : walk(ROOT).filter(f => f.endsWith('.html')).map(f => path.relative(ROOT, f).replace(/\\/g, '/')));

const apps = new Map(); // dir -> [{file, text}]
htmlFiles.forEach(rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const text = fs.readFileSync(abs, 'utf8');
    if (!V_RE.test(text)) { V_RE.lastIndex = 0; return; }
    V_RE.lastIndex = 0;
    const dir = path.dirname(rel);
    if (dir === '.') return; // ルートのハブは対象外
    if (!apps.has(dir)) apps.set(dir, []);
    apps.get(dir).push({ rel, abs, text });
});

const ASSET_RE = /(?:src|href)="([^"#?][^"]*?)(\?v=(\d+))?"/g;
const isExternal = (url) => /^(https?:)?\/\//.test(url) || url.startsWith('data:') || url.startsWith('mailto:');

/* その資産が「別のアプリのもの」なら、そのアプリのディレクトリを返す（自分のものなら null）。
   例: ion-equation/library.html が ../ratio/model.js を読むと 'ratio' を返す */
function foreignApp(f, url) {
    const abs = path.resolve(path.dirname(f.abs), url);
    const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
    const mine = path.dirname(f.rel);
    const owner = [...apps.keys()].filter(d => rel.startsWith(d + '/'))
        .sort((a, b) => b.length - a.length)[0];
    return owner && owner !== mine ? owner : null;
}

/* 「このアプリ自身の版」として数える `?v=`。
   他アプリの資産に付いた番号は**相手の版**なので、自分の版の判定から外す。
   混ぜると「番号が揃っていません」と誤検出し、揃えようとして相手の番号を壊すほうへ誘導する */
function ownVersions(f) {
    let text = f.text;
    [...f.text.matchAll(ASSET_RE)].forEach(m => {
        const [full, url, , v] = m;
        if (!v || isExternal(url)) return;
        if (foreignApp(f, url)) text = text.split(full).join('');
    });
    return new Set([...text.matchAll(V_RE)].map(m => m[1]));
}

/* 他アプリの `?v=` を照合できるよう、先に全アプリの版を割り出す */
const appVersion = new Map();
[...apps.keys()].forEach(dir => {
    const vs = new Set();
    apps.get(dir).forEach(f => ownVersions(f).forEach(v => vs.add(v)));
    const list = [...vs].sort((a, b) => Number(b) - Number(a));
    appVersion.set(dir, list.length ? list[0] : null);
});

const targets = only ? [...apps.keys()].filter(d => d === only) : [...apps.keys()];
if (only && targets.length === 0) {
    console.log(`❌ アプリ '${only}' が見つかりません（候補: ${[...apps.keys()].join(', ') || 'なし'}）`);
    process.exit(1);
}

const summary = [];
targets.sort().forEach(dir => {
    const files = apps.get(dir);

    // 1. `?v=` がすべて同じ番号か
    const seen = new Map(); // version -> [files]
    files.forEach(f => {
        ownVersions(f).forEach(v => {
            if (!seen.has(v)) seen.set(v, []);
            seen.get(v).push(f.rel);
        });
    });
    const versions = [...seen.keys()];
    if (versions.length > 1) {
        const detail = versions.sort((a, b) => Number(a) - Number(b))
            .map(v => `v${v}: ${[...new Set(seen.get(v))].join(', ')}`).join(' / ');
        problems.push(`${dir}: ?v= の番号が揃っていません（${detail}）`);
    }
    const version = appVersion.get(dir);

    // 2. 画面表示のバージョンが一致するか
    files.forEach(f => {
        [...f.text.matchAll(/class="version"[^>]*>\s*v(\d+)/g)].forEach(m => {
            if (version && m[1] !== version) {
                problems.push(`${f.rel}: 表示が v${m[1]} なのに ?v=${version}（ヘッダー表示の更新もれ）`);
            }
        });
        // 見出しの中に素で書かれた版も見る。class="version" を付け忘れた表示は
        // 上の検査をすり抜ける（ion-equation の audit.html が v114 のまま10版ぶん
        // 気づかれずに残っていた実例あり）。h1 に限れば誤検出はしない
        [...f.text.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].forEach(h => {
            [...h[1].matchAll(/\bv(\d+)\b/g)].forEach(m => {
                if (version && m[1] !== version) {
                    problems.push(`${f.rel}: 見出しの表示が v${m[1]} なのに ?v=${version}（ヘッダー表示の更新もれ）`);
                }
            });
        });
    });

    // 3.4. 読み込んでいるローカル資産の実在と、?v= の付け忘れ
    files.forEach(f => {
        [...f.text.matchAll(ASSET_RE)].forEach(m => {
            const [, url, , v] = m;
            if (isExternal(url)) return;
            const ext = path.extname(url).toLowerCase();
            if (!['.js', '.css', '.json'].includes(ext)) return;
            const assetAbs = path.resolve(path.dirname(f.abs), url);
            if (!fs.existsSync(assetAbs)) {
                problems.push(`${f.rel}: 読み込んでいる ${url} が実在しません（改名・削除の取り残し）`);
                return;
            }
            if (!v) {
                problems.push(`${f.rel}: ${url} に ?v= が付いていません（このファイルだけ古いまま配られます）`);
                return;
            }
            // 6. 他アプリの資産を読むときの `?v=` は**相手の版**と一致していること。
            //    ずれていると、相手を更新しても古い実体がキャッシュから配られる
            //    （ion-equation が ratio を v14 のまま読んでいた実例あり）
            const owner = foreignApp(f, url);
            const ownerV = owner && appVersion.get(owner);
            if (ownerV && v !== ownerV) {
                problems.push(`${f.rel}: ${url}?v=${v} は ${owner} の版（v${ownerV}）と違います（相手を更新しても古い実体が配られます）`);
            }
        });
    });

    // 5. 変更があるのに版を上げていないか（本命）
    let bumpNote = '';
    if (hasGit && version) {
        const changed = (git(`diff --name-only HEAD -- ${dir}`) || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (changed.length) {
            const headHtml = files.map(f => git(`show HEAD:${f.rel}`)).filter(Boolean).join('\n');
            const headVs = [...headHtml.matchAll(V_RE)].map(m => m[1]);
            const headV = headVs.length ? headVs.sort((a, b) => Number(b) - Number(a))[0] : null;
            if (headV && headV === version) {
                problems.push(`${dir}: ${changed.length}件の変更があるのに ?v= が v${version} のままです（キャッシュバスターの更新もれ）`);
            } else if (headV) {
                bumpNote = ` / v${headV}→v${version}`;
            }
        }
    }
    summary.push(`  ${dir}: v${version || '?'}（html ${files.length}件${bumpNote}）`);
});

// ---------------------------------------------------------------
// 8. これから push するコミットで、触ったアプリの版が上がっているか
// ---------------------------------------------------------------
// **規則5の死角**（2026-08-07・qa レーンの申告で判明）。規則5は「作業ツリー」しか見ない。
// ところがこのリポジトリは**複数のセッションが1つの作業ツリーを共有する**ので、
// 隣のレーンの未コミットの版上げに、自分の変更が**ただ乗り**できてしまう:
//
//   HEAD: qa は v43
//   レーンA: qa/index.html・test.html・app.js を編集して v44 へ（まだコミットしない）
//   レーンB: qa/questions.json を編集（版は触っていない）
//   → 規則5は「作業ツリーは v43→v44」と見えるので**通る**。作業ツリー自体は正しいので当然
//   → ここで B が questions.json だけコミットすると、**HEAD は「データだけ変わって版は v43」**。
//      公開中の app.js は questions.json?v=43 を読むので、**古いデータが配られ続ける**
//
// 作業ツリーを見ているかぎり「1レーンの正しい作業」と見分けがつかない。
// 見分けがつくのは**コミットが積まれたあと**なので、ここでは push 前の各コミットを
// 1つずつ検算する。事故が公開に出るのは push の瞬間なので、止める場所としてはここで足りる。
if (hasGit) {
    const upstream = (git('rev-parse --abbrev-ref --symbolic-full-name @{u}') || '').trim();
    if (!upstream) {
        warnings.push('追跡先（upstream）が無いため、push 前のコミットの検算を飛ばします');
    } else {
        /* そのコミット時点でのアプリの版。他アプリの資産に付いた `?v=` は相手の版なので外す
           （ownVersions と同じ考え方。ここでは行を読むだけなので単純な除去でよい） */
        const versionAt = (dir, commit) => {
            const vs = [];
            apps.get(dir).forEach(f => {
                const text = git(`show ${commit}:${f.rel}`);
                if (text === null) return;           // そのコミットにはまだ無いファイル
                text.split(/\r?\n/).forEach(line => {
                    if (/(?:src|href)="\.\.\//.test(line)) return;  // 他アプリを読んでいる行
                    [...line.matchAll(/\?v=(\d+)/g)].forEach(m => vs.push(Number(m[1])));
                });
            });
            return vs.length ? Math.max(...vs) : null;
        };

        // **1コミットずつではなく push 全体の差し引きで見る**。配信されるのは最終形であって
        // 途中のコミットではないので、一度もらしても**次のコミットで版を上げ直せば直る**。
        // コミット単位で見ると、その直し方（fix-forward）を弾いて履歴の書き換えへ誘導してしまう
        const nCommits = (git(`rev-list --count ${upstream}..HEAD`) || '0').trim();
        targets.forEach(dir => {
            const changed = (git(`diff --name-only ${upstream} HEAD -- ${dir}`) || '')
                .split('\n').map(s => s.trim()).filter(Boolean);
            if (!changed.length) return;
            const before = versionAt(dir, upstream);
            const after = versionAt(dir, 'HEAD');
            if (before === null || after === null) return;   // 新設アプリなどは判定しない
            if (after <= before) {
                problems.push(
                    `${dir}: push 待ちのコミットで${changed.length}件を変えているのに、版が `
                    + `${upstream} と同じ v${before} のままです（隣のレーンの未コミットの版上げに乗ったまま`
                    + `自分のぶんだけコミットすると起きます。v${before + 1} 以上へ上げ直して、`
                    + `もう1つコミットを積んでから push してください）`
                    // 自分が触っていないアプリで鳴ったときの逃げ道。`${upstream}` は
                    // ローカルの remote-tracking ref なので、**誰かがこのリポジトリの外から
                    // push していると古いまま**になり、その差分まで範囲に入って鳴りうる。
                    // 止まる側の誤りなので実害は無いが、理由が分からないと直しようがない
                    + `\n    ※ このアプリに心当たりが無ければ ${upstream} の ref が古い可能性があります。`
                    + `\`git fetch\` してからもう一度走らせてください`);
            }
        });
        if (Number(nCommits) > 0) {
            summary.push(`  （push 待ちの ${nCommits} 件を ${upstream} との差し引きで検算）`);
        }
    }
}

// ---------------------------------------------------------------
// 6.7. 文字化けと BOM（アプリに限らずリポジトリ全体のテキスト）
// ---------------------------------------------------------------
// 化けは必ず**連なって**現れる（v104 で見つかった「単結合」の化けは5文字連続だった）。
// 1文字だけの出現は DEVELOPMENT.md / CLAUDE.md が「この文字に注意」と**説明している行**なので、
// 2文字以上の連続を条件にして、説明文を誤検出しないようにする。
//
// 文字集合は **\u エスケープで書く**。ここに化け文字をそのまま書くと、
// このファイル自身が検出対象になって必ず不合格になる（箱庭検証で実際に起きた）
const CORE = '\u7E3A\u7E67\u7E5D\u870A\u8373\u90A8\u86FE\u5021'  // 化けたときに頻出する漢字
    + '\u8B41\u87C4\u86FB\u8B92\u8757\u9695\u90E2\u9AE2\u7E79';
const EXTRA = CORE + '\uFF61-\uFF9F';   // ＋半角カナ（CP932 化けの目印）
const MOJI_RE = new RegExp(`[${EXTRA}]{2,}`, 'g');
const CORE_RE = new RegExp(`[${CORE}]`);

const TEXT_EXT = ['.js', '.json', '.html', '.css', '.md', '.txt'];
const textFiles = (hasGit ? tracked : walk(ROOT).map(f => path.relative(ROOT, f).replace(/\\/g, '/')))
    .filter(f => TEXT_EXT.includes(path.extname(f).toLowerCase()));

let scanned = 0;
textFiles.forEach(rel => {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) return;
    const buf = fs.readFileSync(abs);
    scanned++;
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) {
        problems.push(`${rel}: UTF-8 の BOM が付いています（BOMなしが規約）`);
    }
    const text = buf.toString('utf8');
    const isDoc = path.extname(rel).toLowerCase() === '.md';
    text.split(/\r?\n/).forEach((line, i) => {
        // マージ衝突の食べ残し。**行頭に7文字そろっているとき**だけ拾う
        // （文中の「=======」は Markdown の区切り線として普通に出る）。
        // 実際に `assembler/tests.js` の**テスト接頭辞の台帳**に `>>>>>>> feat/poly-quiz` が
        // 1行だけ残り、コメントの中なので誰も気づかないまま公開されていた（2026-08-12）。
        // 統合は人の手作業なので、**残骸は人の目ではなくここで止める**
        if (/^(<{7}|={7}|>{7})(\s|$)/.test(line)) {
            problems.push(`${rel}:${i + 1}: マージ衝突の食べ残し「${line.slice(0, 40)}」`);
        }
        // ドキュメントはバッククォート内を見ない。DEVELOPMENT.md / CLAUDE.md が
        // 「この並びの化けに注意」と**実例をバッククォートで引用して説明している**ため
        const body = isDoc ? line.replace(/`[^`]*`/g, '') : line;
        [...body.matchAll(MOJI_RE)].forEach(m => {
            if (!CORE_RE.test(m[0])) return; // 半角カナだけの連続は化けと断定しない
            problems.push(`${rel}:${i + 1}: 文字化けの疑い「${m[0]}」`);
        });
    });
});

function walk(dir, acc = []) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach(e => {
        if (e.name === '.git' || e.name === 'node_modules') return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p, acc); else acc.push(p);
    });
    return acc;
}

console.log(`検査したアプリ: ${targets.length} 件`);
summary.forEach(s => console.log(s));
console.log(`文字化け・BOM を調べたテキスト: ${scanned} 件`);
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
