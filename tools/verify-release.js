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
 *   9. **傍用問題集・教科書の中身が公開物に混ざっていないか**（著作権。入試問題とは扱いが違う）
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

/**
 * そのファイルは**配信されるか**（＝キャッシュバスターの対象か）。
 * 版バンプを求めるかどうかの判定に使う。**規則5と規則8で同じものを使う**
 * （片方だけに掛けたら、もう片方が同じ理由で鳴った）。
 *
 * 除外するもの:
 *   - `.md` … ドキュメント。アプリの HTML は参照していない。
 *     test.html が CERTAINTY_LEDGER.md などを読んでいるが、`?nocache=` + Date.now() で
 *     読むので版とは無関係（`?v=` を使っていない）
 *   - `tools/` 配下 … 開発用スクリプト。node で走らせるもので配信されない
 *   - `assembler/demos*.json` … 録画モードの台本。**`rec.js` が `cache: 'no-cache'` で読み、
 *     `?v=` を通していない**（2026-08-31・動画レーンの申告で判明）。
 *     ⚠ **これは「例外」ではなく「規則の対象外」**。`?v=` を通さないファイルは
 *     キャッシュバスターの守備範囲に最初から入っていない。
 *     ★ **この前提が崩れたら下の規則5bが赤くなる**ので、黙って甘くはならない。
 *     ⚠ **人の記憶で回すと必ず抜ける**（実際に3日で3回、意味のない版上げのために赤が出て、
 *     そのたびに「本物の事故と区別できない赤」を1件増やしていた）。
 *
 * 逆に **`.json` / `.jsonl` は必ず数える**。qa/app.js が `questions.json?v=NN` を
 * `data/exam_usage.jsonl?v=NN` を読んでおり、ここが実際に事故った場所
 * （tests.js:817 に「v58 のまま置き去りになっていた」記録がある）。
 * ⚠ **だから demos だけを名指しで外す**。「json を全部外す」は上の事故に戻る。
 */
const isServedPath = rel =>
    path.extname(rel).toLowerCase() !== '.md' && !/(^|\/)tools\//.test(rel)
    && !/(^|\/)demos[^/]*\.json$/.test(rel);
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
    //
    // ⚠ **配信されないものは数えない**（2026-08-13 追加）。
    // それまでは `git diff --name-only` の結果をそのまま数えていたので、
    // **設計書や依頼パックを直しただけで「版を上げよ」と言っていた**。
    // 通すために意味のない版バンプをすると、**中身が変わっていないのにキャッシュを捨てる**
    // ことになるので、誘導としてよくない。除外するのは次の2つ:
    //
    //   - `.md` … ドキュメント。アプリの HTML は参照していない。
    //     test.html が CERTAINTY_LEDGER.md などを読んでいるが、**`?nocache=` + Date.now()**
    //     で読むので版とは無関係（`?v=` を使っていない）
    //   - `tools/` 配下 … 開発用スクリプト。配信されない（node で走らせるもの）
    //
    // **除外した件数は下の summary に出す。** 黙って数を減らすと、
    // 検査が甘くなったことが読めなくなる。
    let bumpNote = '';
    let skipNote = '';
    if (hasGit && version) {
        const allChanged = (git(`diff --name-only HEAD -- ${dir}`) || '').split('\n').map(s => s.trim()).filter(Boolean);
        const changed = allChanged.filter(isServedPath);
        const skipped = allChanged.length - changed.length;
        if (skipped) skipNote = ` / 配信外 ${skipped}件は除外`;
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
    summary.push(`  ${dir}: v${version || '?'}（html ${files.length}件${bumpNote}${skipNote}）`);
});

// ---------------------------------------------------------------
// 5b. demos*.json を版の対象外にしている「前提」が、まだ生きているか
// ---------------------------------------------------------------
// ⚠⚠ **除外は、その理由が成り立っているあいだだけ正しい。**
// `isServedPath` が `demos*.json` を外しているのは「`?v=` を通していないから」であって、
// 「台本だから」ではない。★ **理由のほうが崩れたら、除外は黙って穴になる。**
// そこでここで前提を2つとも機械で見張る:
//
//   (a) `rec.js` の台本ローダーが `cache: 'no-cache'` で読んでいること
//   (b) どこからも `demos*.json?v=` の形で参照されていないこと
//
// どちらかが崩れたら**赤で止める**（＝ そのときは除外をやめるか、参照側を直すかを人が決める）。
{
    const recAbs = path.join(ROOT, 'assembler', 'rec.js');
    if (fs.existsSync(recAbs)) {
        const rec = fs.readFileSync(recAbs, 'utf8');
        // DEMO_FILES を回している fetch が no-cache か。
        // ⚠ 行番号で見ない（動く）。`DEMO_FILES` の for から次の閉じ括弧までを窓にする
        const from = rec.indexOf('DEMO_FILES');
        const win = from >= 0 ? rec.slice(from, from + 1200) : '';
        if (!/cache:\s*['"]no-cache['"]/.test(win)) {
            problems.push(
                'assembler/rec.js: 台本（demos*.json）を no-cache で読まなくなっています。' +
                '★ verify-release が demos*.json を版の対象外にしている理由がここなので、' +
                '対象外をやめる（isServedPath から demos の行を消す）か、no-cache に戻してください');
        }
    }
    // (b) `demos*.json?v=` の参照がどこかに生えていないか（html も js も見る）
    const hits = [];
    const scan = (dir) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const abs = path.join(dir, e.name);
            const rel = path.relative(ROOT, abs).replace(/\\/g, '/');
            if (e.isDirectory()) {
                // ⚠ `tools/` は配信されないので、そこに `?v=` の字が出ても事故にならない
                //   （この検査自身の説明文がここで引っかかった。2026-08-31）
                if (/^(\.git|node_modules|\.claude|tools)$/.test(e.name)) continue;
                scan(abs);
            } else if (/\.(html|js|mjs)$/.test(e.name)) {
                const t = fs.readFileSync(abs, 'utf8');
                if (/demos[^/"'\s]*\.json\?v=/.test(t)) hits.push(rel);
            }
        }
    };
    scan(ROOT);
    if (hits.length) {
        problems.push(
            `demos*.json に ?v= を付けて読んでいる箇所があります（${hits.slice(0, 3).join(' ')}）。` +
            '★ 版の対象外にしている前提が崩れたので、isServedPath から demos の行を消してください');
    }
}

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
            // 規則5と**同じ除外**を掛ける（`isServedPath`）。ここを揃えないと、
            // 設計書や依頼パックだけのコミットで「版を上げよ」と言われる ——
            // 実際に鳴った（2026-08-13・.md 4件と tools/*.js 1件のコミット）。
            const changed = (git(`diff --name-only ${upstream} HEAD -- ${dir}`) || '')
                .split('\n').map(s => s.trim()).filter(Boolean).filter(isServedPath);
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

// ⚠ **`.jsonl` が抜けていた**（2026-08-13 に発見）。qa/data/ の配信データはほぼ全部 .jsonl なので、
//   `exam_usage.jsonl` を含めて**化けも BOM も一度も検査されていなかった**。
const TEXT_EXT = ['.js', '.json', '.jsonl', '.html', '.css', '.md', '.txt'];
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

// ---------------------------------------------------------------
// 6.8. 傍用問題集・教科書の中身が公開物に混ざっていないか（著作権）
// ---------------------------------------------------------------
// **方針（ユーザー判断・2026-08-13）**:
//   **入試問題** … 出典（大学・年・大問番号）を示してよい。問題を引く逆引きの対象にしてよい
//   **セミナー・教科書** … 難易度・頻度の**参考値**まで。**問題を引く対象にしない**
//
// ⚠ **リポジトリに置く＝ GitHub Pages が配る。** 実際に2つ漏れていた（2026-08-13 に発見）:
//   ・`qa/data/seminar_map_ch*.jsonl` … 「基本例題42 → 扱う知識項目」の対応表16件。
//     URL を叩けば傍用問題集の索引が引けた
//   ・`qa/data/textbook_scope.md` … 教科書の「PLUS」欄の**見出しを48件そのまま**並べた一覧。
//     実質その教科書の発展欄の目次。**.md は規則5の対象外**なので誰も気づけなかった
//   どちらも `_解析/workbook/`（リポジトリの外）へ移した。**戻ってこないようにここで見張る。**
//
// 出すのは**区分の語だけ**（本文 / 発展欄 / 見あたらない / プロセス / 基本 / 発展 / 未登場）。
// これは判定結果であって、相手の中身ではない。
const SOURCE_LEAK = [
    [/^(基本|発展)(例題|問題)\s*\d+/m, 'セミナーの問題番号'],
    [/"item"\s*:\s*"(基本|発展)(例題|問題)\s*\d+"/, 'セミナーの問題番号'],
    [/"item"\s*:\s*"プロセス\s*\d+"/, 'セミナーのプロセス番号'],
    [/^-\s*PLUS\s+\S/m, '教科書の発展欄（PLUS）の見出し'],
];
// 方針そのものを説明している文書は除く（説明文に語が出るのは当たり前）
const POLICY_DOC = /(DESIGN_|TAXONOMY|KNOWLEDGE_CAVEATS|HANDOFF_|gemini-pack-|CLAUDE\.md|DEVELOPMENT\.md|README)/;
textFiles.filter(rel => rel.startsWith('qa/') && !rel.startsWith('qa/tools/') && !POLICY_DOC.test(rel))
    .forEach(rel => {
        const abs = path.join(ROOT, rel);
        if (!fs.existsSync(abs)) return;
        const text = fs.readFileSync(abs, 'utf8');
        SOURCE_LEAK.forEach(([re, what]) => {
            const m = text.match(re);
            if (m) problems.push(`${rel}: ${what}が公開物に入っています「${m[0].slice(0, 30)}」`
                + '（セミナー・教科書は参考値まで。材料は _解析/workbook/ に置く）');
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
