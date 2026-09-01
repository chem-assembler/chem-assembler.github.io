/**
 * sitemap.xml を生成する。
 *
 *   node tools/gen-sitemap.js          … 生成して書き出す
 *   node tools/gen-sitemap.js --check  … 中身が最新かだけ見る（書き換えない・ズレていたら終了コード1）
 *
 * **なぜ道具にするか**: 手書きの sitemap は、ページを足したときと中身を直したときの
 * 両方で腐る。腐った sitemap は「無い」より悪い（古い更新日を検索エンジンに教え続ける）。
 * **`lastmod` は git のコミット日から取る**ので、人が日付を覚えておく必要がない。
 *
 * **収録しないもの**:
 *   ・`noindex` の付いたページ（ratio 一式＝プロトタイプ）。sitemap と meta が矛盾すると
 *     クロールの無駄になるだけで、順位には足しにならない
 *   ・test.html / audit.html（開発用）・devices.html（端末プレビュー）
 *   ・chrono_index.html（化学レンズの一部ではない）
 *   ・_config.yml で配信から外しているもの
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ORIGIN = 'https://chem.schoollenz.com';

/* URL と、その中身を持つファイル。**ページを足したらここに1行足す**。
   `?open=` などのパラメータ付き URL は入れない（同じページの別状態なので重複扱いになる） */
const PAGES = [
    ['/', 'index.html'],
    ['/assembler/', 'assembler/index.html'],
    ['/ion-equation/portal.html', 'ion-equation/portal.html'],   // ハブが指している入口
    ['/ion-equation/', 'ion-equation/index.html'],
    ['/ion-equation/library.html', 'ion-equation/library.html'],
    ['/ion-equation/redox.html', 'ion-equation/redox.html'],
    ['/ion-equation/battery.html', 'ion-equation/battery.html'],
    ['/ion-equation/condition.html', 'ion-equation/condition.html'],
    ['/qa/', 'qa/index.html'],
    // ⚠ 2026-09-02: `/muki/` は入口（3つの遊び方の一覧）になり、スネークは snake.html へ移った。
    //   ★ `/muki/` だけを載せていると、**中身のある3枚が sitemap から消えた**ことになる
    //     （旧 `/muki/` ＝ スネークの実体は、この日から snake.html にある）。
    //   ⚠ 型B / 型A は前から canonical と OGP を名乗っていたのに sitemap に無かった。
    //     入口を作って対等に並べたので、ここでも対等に載せる
    ['/muki/', 'muki/index.html'],
    ['/muki/snake.html', 'muki/snake.html'],
    ['/muki/separation.html', 'muki/separation.html'],
    ['/muki/tree.html', 'muki/tree.html'],
    ['/privacy.html', 'privacy.html'],
];

/* 異性体ページ（`tools/gen-isomer-pages.mjs` が生成）は**枚数が増えるので走査で拾う**。
   PAGES に手で足す方式だと、分子式を追加したときに sitemap への追記を忘れる。 */
const isomerDir = path.join(ROOT, 'isomers');
if (fs.existsSync(isomerDir)) {
    PAGES.push(['/isomers/', 'isomers/index.html']);
    fs.readdirSync(isomerDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .sort((a, b) => a.name.localeCompare(b.name))
        .forEach(d => PAGES.push([`/isomers/${d.name}/`, `isomers/${d.name}/index.html`]));
}

const problems = [];

const lastmod = (rel) => {
    try {
        const d = execSync(`git log -1 --format=%cs -- "${rel}"`, { cwd: ROOT, encoding: 'utf8' }).trim();
        return d || null;
    } catch (e) { return null; }
};

const entries = PAGES.map(([url, rel]) => {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) { problems.push(`${rel} が無い（PAGES から消すか、パスを直す）`); return null; }
    // sitemap と meta の食い違いは自分で見つける。人の記憶に頼らない
    if (/<meta\s+name="robots"[^>]*noindex/i.test(fs.readFileSync(full, 'utf8'))) {
        problems.push(`${rel} は noindex なのに PAGES に入っている`);
        return null;
    }
    const d = lastmod(rel);
    if (!d) { problems.push(`${rel} のコミット日が取れない（未コミット？）`); return null; }
    return `  <url>\n    <loc>${ORIGIN}${url}</loc>\n    <lastmod>${d}</lastmod>\n  </url>`;
}).filter(Boolean);

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
    + entries.join('\n') + '\n</urlset>\n';

if (problems.length) {
    console.error('❌ ' + problems.length + ' 件の問題:');
    problems.forEach(p => console.error('  - ' + p));
    process.exit(1);
}

const out = path.join(ROOT, 'sitemap.xml');
const check = process.argv.includes('--check');
const current = fs.existsSync(out) ? fs.readFileSync(out, 'utf8').replace(/\r\n/g, '\n') : null;

/* `--check` が見るのは **URL の顔ぶれだけ**で、`lastmod` のズレは咎めない。
   日付まで一致を求めると、ページを1行直すたびに鳴る門番になり、
   **鳴りっぱなしの検査は読まれなくなる**。実際に腐るのは「ページを足したのに
   sitemap に無い」「消したのに残っている」「noindex にしたのに載っている」で、
   そこは上の PAGES 検査と下の突き合わせで捕まる。日付は生成し直せばいつでも直る。 */
if (check) {
    const locsOf = (s) => (s ? [...s.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]) : []);
    const want = locsOf(xml), got = locsOf(current);
    const missing = want.filter(u => !got.includes(u));
    const extra = got.filter(u => !want.includes(u));
    if (!missing.length && !extra.length) {
        console.log(`✅ sitemap.xml の URL は揃っています（${want.length} 件）`);
        process.exit(0);
    }
    console.error('❌ sitemap.xml の URL がずれています。`node tools/gen-sitemap.js` で作り直してください');
    missing.forEach(u => console.error('  - 足りない: ' + u));
    extra.forEach(u => console.error('  - 余分:     ' + u));
    process.exit(1);
}

fs.writeFileSync(out, xml, 'utf8');
console.log(`✅ sitemap.xml を書き出しました（${entries.length} URL）`);
entries.forEach(e => console.log('   ' + e.match(/<loc>([^<]+)<\/loc>/)[1]));
