/**
 * 端末エミュレーションでの表示検査（Node で実行。ブラウザの手動操作は不要）
 *
 *   node tools/check-mobile.mjs                  … 全ページ × 全端末（20種）
 *   node tools/check-mobile.mjs ratio            … アプリを1つに絞る
 *   node tools/check-mobile.mjs --quick          … 代表4端末だけ（作業中の素早い確認用）
 *   node tools/check-mobile.mjs --shots out/     … スクリーンショットも保存する
 *   node tools/check-mobile.mjs --list           … 端末一覧を出して終わる
 *
 * Playwright の端末プロファイル（画面幅・DPR・タッチ・モバイルUA）で各ページを開いて測る。
 * 依存は tools/record/ の Playwright を借りる（追加インストール不要）。
 * 配信サーバーは自分で立てて自分で止めるので、事前準備は要らない。
 *
 * なぜこれが要るか:
 *   Claude のブラウザペインは、非表示のとき `document.hidden === true` になり
 *   **描画のライフサイクルごと止まる**。resize も ResizeObserver も
 *   requestAnimationFrame も配られないため、「画面幅を変えたときの追随」を
 *   あの環境では検証できない（無関係な要素を JS で 100px→250px に変えても
 *   ResizeObserver の callback が0回、で確認済み）。ここは実際に描画が回る。
 *
 * 検査項目:
 *   1. ページ本体が横スクロールしないか（scrollWidth > clientWidth）
 *   2. はみ出している要素が、**横スクロールできる枠の中にあるか**
 *      枠の外＝黙って切り落とされているか本体を押し広げている ＝ 不合格。
 *      帯（ステージ選択・3行表・単元表）のように枠の中で送るのは設計どおりなので合格
 *   3. ヘッダーが画面の高さをどれだけ占めるか（20%超で警告）。ただし警告にするのは
 *      **居座るヘッダー（sticky/fixed）か、1画面で完結する操作画面**のときだけ。
 *      スクロールで流れるヘッダーは操作を妨げないので「参考」に回す
 *   4. タップ標的が小さすぎないか（32px 未満のボタン・リンクを警告）
 *   5. JS のエラーが出ていないか
 *
 * 終了コード 0 = 合格、1 = 問題あり
 */
import { createRequire } from 'module';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* ⚠ tools/record/node_modules は**追跡外**なので git worktree には無い。
   並行レーン（worktree）から走らせても止まらないよう、見つからなければ
   本体の作業ツリー（git worktree list の先頭）を当たり直す。
   tools/check-desktop.mjs も同じ手当てを持っている。 */
let playwright;
{
    const roots = [ROOT];
    try {
        const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
        const first = out.split('\n').find(l => l.startsWith('worktree '));
        if (first) roots.push(first.slice('worktree '.length).trim());
    } catch (e) { /* git が無くても本筋は動く */ }
    for (const r of roots) {
        try { playwright = createRequire(path.join(r, 'tools/record/')).call(null, 'playwright'); break; } catch (e) { /* 次を試す */ }
    }
    if (!playwright) {
        console.error('Playwright が見つかりません。tools/record で `npm install` を1度だけ実行してください。');
        process.exit(1);
    }
}
const { chromium, devices } = playwright;

/* ---------------------------------------------------------------
   端末の並び
   幅の「刻み」で選んである。レイアウトが見ているのは CSS の画面幅なので、
   同じ幅の機種はまとめて1つで代表できる（例: 375px は iPhone SE3 / 8 / 7 が同じ）。
   代表に選んだ機種名の横に、同じ幅になる主な機種を書いてある。
   --------------------------------------------------------------- */
const DEVICE_SET = [
    // --- スマホ・縦 ---
    { key: 'iPhone SE', note: '320px — SE(初代/2)・Galaxy S9+。いま実用されている最小の幅', quick: true },
    { key: 'Galaxy S24', note: '360px — Android で最も多い幅（Galaxy・AQUOS・Xperia の多く）', quick: true },
    { key: 'iPhone SE (3rd gen)', note: '375px — SE3・8・7・X・12 mini。保有数が多い' },
    { key: 'iPhone 13', note: '390px — 12・13・14・16e', quick: true },
    { key: 'iPhone 15', note: '393px — 15・16・14 Pro・Pixel 5' },
    // 実機（iPhone・iOS 18.7・Safari 26.6・dpr3）で測った値。screen は 393×852 だが
    // **CSS の見える高さは 635**（アドレスバーが出ているとき）。Playwright の既製
    // 'iPhone 15'（393×659）は**実機より 24px 高く、縦の検査がわずかに甘い**。
    // ⚠ **iOS のアドレスバーの伸縮は 100px**（Pixel 10a の 80px より大きい）＝
    //    「開いた瞬間だけはみ出す」の幅が Android より広い。
    { base: 'iPhone 15', name: 'iPhone 実測（バーあり）', viewport: { width: 393, height: 635 },
      note: '393×635 — 開いた直後。100dvh=635 / 100vh=735', quick: true },
    { base: 'iPhone 15', name: 'iPhone 実測（バー引込）', viewport: { width: 393, height: 735 },
      note: '393×735 — 少し繰った後。差の 100px がアドレスバーの分' },
    { key: 'iPhone 17', note: '402px — 16 Pro・17' },
    { key: 'Pixel 7', note: '412px — Pixel 6〜8・Nexus 系' },
    // 実機（Pixel 10a・Chrome 150）で測った値。Playwright の既製 'Pixel 7'（412×915）は
    // **実機より 130px 高く、縦の検査が甘くなる**ので、実測のほうも並べて回す。
    // devices.html の一覧と同じ幅・同じ高さにしてあること（片方だけ足すと数字と絵がずれる）。
    { base: 'Pixel 7', name: 'Pixel 10a 実測（バーあり）', viewport: { width: 411, height: 785 },
      note: '411×785 — 開いた直後。100dvh=786 / 100vh=866', quick: true },
    { base: 'Pixel 7', name: 'Pixel 10a 実測（バー引込）', viewport: { width: 411, height: 865 },
      note: '411×865 — 少し繰った後。差の 80px がアドレスバーの分' },
    { key: 'iPhone 11', note: '414px — 11・XR・8 Plus。保有数が多い' },
    { key: 'iPhone 15 Pro Max', note: '430px — 14 Pro Max・15 Plus/Pro Max・16 Plus' },
    { key: 'iPhone 17 Pro Max', note: '440px — 16/17 Pro Max。いまの最大' },
    // --- タブレット・縦 ---
    { key: 'iPad Mini', note: '768px — iPad mini・iPad(5/6世代)' },
    { key: 'iPad (gen 7)', note: '810px — iPad(7〜9世代)。学校で多い', quick: true },
    { key: 'iPad Pro 11', note: '834px — iPad Pro 11・Air' },
    // 実機（Surface・Chrome 147・dpr2）で測った値。境目 900 をわずか 12px 超えるので
    // **タブレットとして持っているのに PC 3カラムが当たる**幅。ここは実機でしか気づけなかった。
    { base: 'iPad Pro 11', name: 'Surface 縦 実測', viewport: { width: 912, height: 1199 },
      note: '912×1199 — 実機の縦向き。900 の境目のすぐ上', quick: true },
    { key: 'Galaxy Z Fold 7', note: '984px — 折りたたみの内側' },
    // --- 横向き（高さが厳しくなる。ヘッダーの厚みはここで効く） ---
    { key: 'iPhone SE landscape', note: '568×320 — 横向きで最も高さが無い' },
    { key: 'iPhone 13 landscape', note: '750×342 — スマホ横向きの標準的な形' },
    { base: 'Pixel 7', name: 'Pixel 10a 横 実測', viewport: { width: 865, height: 307 },
      note: '865×307 — 実機の横向き。表の「標準」342 より 35px 低い＝**横はここが最悪**' },
    { key: 'iPad Pro 11 landscape', note: '1194×834 — タブレット横向き' },
    { base: 'iPad Pro 11', name: 'Surface 横 実測', viewport: { width: 1368, height: 743 },
      note: '1368×743 — 実機の横向き。端末は 1368×912 だがブラウザの枠を引くと 743' },
    // --- iPad のマルチタスク（実機の分割表示。Playwright に既製がないので幅だけ再現） ---
    { base: 'iPad Pro 11', name: 'iPad 分割表示 1/2', viewport: { width: 507, height: 1194 }, note: '507px — Split View で半分' },
    { base: 'iPad Pro 11', name: 'iPad 分割表示 1/3', viewport: { width: 375, height: 1194 }, note: '375px — Split View で1/3・Slide Over' },
    { base: 'iPad (gen 7)', name: 'iPad 分割表示 2/3', viewport: { width: 694, height: 1080 }, note: '694px — Split View で2/3' },
];

function buildDevice(d) {
    const base = devices[d.base || d.key];
    if (!base) return null;
    return { name: d.name || d.key, note: d.note, opts: { ...base, ...(d.viewport ? { viewport: d.viewport } : {}) } };
}

/* --------------------------------------------------------------- */
const PAGES = [
    ['hub', '/'],
    ['hub', '/privacy.html'],
    ['ion-equation', '/ion-equation/'],
    ['ion-equation', '/ion-equation/redox.html'],
    ['ion-equation', '/ion-equation/battery.html'],
    ['ion-equation', '/ion-equation/condition.html'],
    ['ion-equation', '/ion-equation/oxidation.html'],
    ['ion-equation', '/ion-equation/library.html'],
    ['ion-equation', '/ion-equation/portal.html'],
    ['ratio', '/ratio/'],
    ['ratio', '/ratio/proportion.html'],
    ['ratio', '/ratio/stoich.html'],
    ['ratio', '/ratio/titration.html'],
    ['ratio', '/ratio/thermo.html'],
    ['ratio', '/ratio/balance.html'],
    ['muki', '/muki/'],
    ['qa', '/qa/'],
    ['assembler', '/assembler/'],
];

// --- 引数 ---
const args = process.argv.slice(2);
const take = (flag) => { const i = args.indexOf(flag); if (i < 0) return null; const v = args[i + 1]; args.splice(i, v && !v.startsWith('--') ? 2 : 1); return v || true; };
const shotsDir = take('--shots');
const quick = !!take('--quick');
const listOnly = !!take('--list');
const only = args[0] || null;

const deviceList = DEVICE_SET.filter((d) => !quick || d.quick).map(buildDevice).filter(Boolean);
if (listOnly) {
    deviceList.forEach((d) => console.log(`${d.name.padEnd(24)} ${d.opts.viewport.width}×${d.opts.viewport.height}  dpr${d.opts.deviceScaleFactor}  ${d.note || ''}`));
    process.exit(0);
}
const pages = PAGES.filter(([app]) => !only || app === only);
if (!pages.length) {
    console.error(`アプリ「${only}」に対応するページがありません。指定できるのは: ${[...new Set(PAGES.map(p => p[0]))].join(' / ')}`);
    process.exit(1);
}

// --- ページの中で走る測定 ---
function measure() {
    const de = document.documentElement;
    const escaped = [];   // 送れる枠の外にはみ出している＝問題
    const inBand = [];    // 枠の中で送っている＝設計どおり
    const parked = [];    // 画面外に退避している引き出し＝設計どおり
    document.querySelectorAll('body *').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width <= 0 || r.right <= de.clientWidth + 1) return;
        // **完全に画面の外にいる position:fixed の要素は、開くと出てくる引き出し**
        // （assembler の右パネルなど）。閉じている状態を不具合と数えない。
        // 画面内から始まってはみ出しているものだけが本当の問題
        if (r.left >= de.clientWidth - 1) {
            let isFixed = false;
            for (let n = e; n && n !== de; n = n.parentElement) {
                if (getComputedStyle(n).position === 'fixed') { isFixed = true; break; }
            }
            if (isFixed) { parked.push(e.id ? '#' + e.id : e.tagName); return; }
        }
        let scroller = null;
        for (let n = e.parentElement; n && n !== de; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if ((ox === 'auto' || ox === 'scroll') && n.scrollWidth > n.clientWidth) { scroller = n; break; }
            if (ox === 'hidden' && n.scrollWidth > n.clientWidth) break; // 黙って切られている
        }
        const label = (e.id ? '#' + e.id : e.tagName +
            (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')) +
            ' right=' + Math.round(r.right);
        (scroller ? inBand : escaped).push(label);
    });
    // タップ標的。**本文中のリンクは対象外**（display:inline の a は行の一部であって
    // 押しボタンではない。ここを拾うと警告が数百件になって使い物にならない）。
    // ボタン状のもの——button/input/select/summary と、箱になっている a——だけを見る。
    const small = [];
    document.querySelectorAll('button, input, select, summary, a').forEach((e) => {
        const r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden') return;
        if (e.tagName === 'A' && cs.display === 'inline') return;
        if (r.height < 32 || r.width < 24) {
            small.push((e.id ? '#' + e.id : e.tagName +
                (typeof e.className === 'string' && e.className ? '.' + e.className.split(' ')[0] : '')) +
                ' ' + Math.round(r.width) + '×' + Math.round(r.height));
        }
    });
    const header = document.querySelector('header') || document.getElementById('header');
    return {
        headerPos: header ? getComputedStyle(header).position : null,
        // 縦にスクロールする文書かどうか。**流れて消えるヘッダー**と**居座るヘッダー**では
        // 画面を占めることの意味がまったく違う
        pageScrolls: de.scrollHeight > window.innerHeight + 2,
        scrollW: de.scrollWidth, clientW: de.clientWidth,
        dpr: window.devicePixelRatio, touch: 'ontouchstart' in window, hidden: document.hidden,
        headerH: header ? Math.round(header.getBoundingClientRect().height) : null,
        winH: window.innerHeight,
        escaped: escaped.slice(0, 8), escapedCount: escaped.length, inBandCount: inBand.length,
        parkedCount: parked.length,
        small: [...new Set(small)].slice(0, 6), smallCount: small.length,
    };
}

// --- 配信サーバー（自分で立てて自分で止める） ---
const freePort = () => new Promise((res) => {
    const s = net.createServer();
    s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); });
});
const port = await freePort();
const server = spawn('python', ['-m', 'http.server', String(port)], { cwd: ROOT, stdio: 'ignore' });
const BASE = `http://localhost:${port}`;
const stop = () => { try { server.kill(); } catch (e) { /* noop */ } };
process.on('exit', stop);
await new Promise((r) => setTimeout(r, 700));

if (shotsDir && shotsDir !== true) fs.mkdirSync(shotsDir, { recursive: true });

const problems = [];
const warnings = [];
const infos = [];
const browser = await chromium.launch();

// 端末ごとに1つの context を作り、数台ぶんを同時に走らせる（直列だと端末数×ページ数で時間がかかる）
const CONCURRENCY = 5;
async function runDevice(dev) {
    const ctx = await browser.newContext(dev.opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 140)));
    for (const [, url] of pages) {
        const where = `${dev.name} ${url}`;
        try {
            await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 25000 });
            await page.waitForTimeout(250);
            const m = await page.evaluate(measure);
            if (shotsDir && shotsDir !== true) {
                await page.screenshot({ path: path.join(shotsDir, `${url.replace(/[^\w]+/g, '_')}__${dev.name.replace(/[^\w]+/g, '-')}.png`) });
            }
            if (m.scrollW > m.clientW) {
                problems.push(`${where}: ページ本体が横スクロールします（${m.scrollW} > ${m.clientW}）`);
            }
            if (m.escapedCount) {
                problems.push(`${where}: 横に送れる枠の外にはみ出している要素が ${m.escapedCount} 件 — ${m.escaped.join(' / ')}`);
            }
            if (m.headerH != null && m.headerH / m.winH > 0.20) {
                const line = `${where}: ヘッダーが画面の ${Math.round(m.headerH / m.winH * 100)}%（${m.headerH}px / ${m.winH}px）`;
                // **居座るヘッダー（sticky/fixed）**か、**1画面で完結する操作画面**のときだけ警告する。
                // スクロールで流れていくヘッダーは、最初の一画面の見た目でしかなく操作を妨げない。
                // privacy.html は position:static・文書高2329px に対し画面320px で 57% と出ていたが、
                // 読み進めれば消える。ここを警告にすると、読み物を意味なく痩せさせることになる
                if (m.headerPos === 'sticky' || m.headerPos === 'fixed' || !m.pageScrolls) warnings.push(line);
                else infos.push(line + `（${m.headerPos}・スクロールで流れる）`);
            }
            if (m.smallCount) {
                warnings.push(`${where}: 小さいタップ標的 ${m.smallCount} 件 — ${m.small.join(' / ')}`);
            }
            if (errors.length) {
                problems.push(`${where}: JS エラー — ${errors.splice(0).join(' / ')}`);
            }
        } catch (e) {
            problems.push(`${where}: 開けません — ${String(e).slice(0, 140)}`);
        }
    }
    await ctx.close();
}

const queue = [...deviceList];
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await runDevice(queue.shift());
}));
await browser.close();
stop();

console.log(`検査したページ: ${pages.length} 件 × 端末 ${deviceList.length} 種 = ${pages.length * deviceList.length} 通り`);
if (shotsDir && shotsDir !== true) console.log(`スクリーンショット: ${path.resolve(shotsDir)}`);
if (infos.length) {
    console.log(`
参考 ${infos.length} 件（流れていくヘッダー。占有率は最初の一画面の見た目にすぎない）:`);
    infos.sort().slice(0, 6).forEach((i) => console.log('  - ' + i));
    if (infos.length > 6) console.log(`  … ほか ${infos.length - 6} 件`);
}
if (warnings.length) {
    console.log(`\n△ 警告 ${warnings.length} 件（不合格ではない）:`);
    warnings.sort().forEach((w) => console.log('  - ' + w));
}
if (problems.length) {
    console.log(`\n❌ ${problems.length} 件の問題:`);
    problems.sort().forEach((p) => console.log('  - ' + p));
    process.exit(1);
}
console.log('\n✅ 不合格の問題はありません');
