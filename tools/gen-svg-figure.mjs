/**
 * 参考書の図を **SVG のソース（`reference-svg/*.svg`）から焼く**（`reference-img/<同じ名>.png`）。
 *
 *   node tools/gen-svg-figure.mjs              … 原稿の `svg:` を全部焼く
 *   node tools/gen-svg-figure.mjs colligative  … そのページの図だけ
 *   node tools/gen-svg-figure.mjs --check      … 焼かずに「ソースが在るか・PNG が在るか」だけ見る（ブラウザ不要）
 *
 * ★★ なぜ在るか（2026-09-21）: スライドにも作図器にも出どころが無い図が **30枚ほど**残った
 *    （装置の絵・模式図・グラフ）。`gen-figure.mjs` は分子しか描けず、`clip-pdf.py` は出どころが要る。
 *    画像を直接置くと **差分が読めず、あとから1文字も直せない**。
 *    ★ **図の正を SVG のソース（文字）で持てば**、差分が読めて・レーン（文字だけを書く便）でも描けて・
 *      あとから線を1本足せる。**PNG は生成物**（`reference-img/` に焼く。面Aは今までどおり PNG を指す）。
 *
 * ⚠ 原稿の書き方（`reference-md.js` が見る）:
 *
 *      :::figure
 *      src: colligative-cooling-curve.png      ← svg: と同じ名の .png（機械が突き合わせる）
 *      svg: colligative-cooling-curve.svg      ← reference-svg/ の中のファイル名だけ
 *      alt: …
 *      caption: …
 *      :::
 *
 * ⚠ SVG の決めごと（焼く前に見る）:
 *   - `width` と `height` を px で持つ（`viewBox` だけだと大きさが決まらない）。幅は 1200px 以下
 *   - **外の資産を読まない**（`<image>`・`@import`・`xlink:href` の外部参照・web フォント）。
 *     焼くのは手元のブラウザなので、外を読む図は焼く人の環境で見た目が変わる
 *   - 文字は日本語が出る指定で（`font-family` は `system-ui, sans-serif` を既定に）。
 *     ⚠ 焼いたあとは**必ず目で見る**（文字が枠からはみ出していないか）
 */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SRC = path.join(ROOT, 'reference-src');
const SVG = path.join(ROOT, 'reference-svg');
const IMG = path.join(ROOT, 'reference-img');
const RM = require('./reference-md.js');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const ONLY = args.filter(a => !a.startsWith('--'));
/* 公開ページの本文の幅（図はこの幅いっぱいに出る）と、図の中の字の床（最終的な見た目・2026-09-24） */
const BODY_W = 680;
const MIN_TEXT = Number((process.argv.find(a => a.startsWith('--min-text=')) || '').split('=')[1] || 14);
/* 下付き（添え字）の床（2026-09-24 ユーザー決定。見た目が小さすぎればあとで見直す） */
const MIN_SUB = Number((process.argv.find(a => a.startsWith('--min-sub=')) || '').split('=')[1] || 11);
const WARN_BYTES = 100 * 1024;   // 1枚 100KB を超えたら切り直しを促す（止めない）
const MAX_W = 1200;

/** 原稿から `svg:` を持つ図を集める */
function collect() {
    const ids = RM.normalize(readFileSync(path.join(SRC, 'ORDER.txt'), 'utf8')).split('\n')
        .map(s => s.trim()).filter(s => s && !s.startsWith('#'));
    const jobs = [];
    ids.forEach(id => {
        if (ONLY.length && !ONLY.includes(id)) return;
        const where = `reference-src/${id}.md`;
        const page = RM.parsePage(readFileSync(path.join(SRC, id + '.md'), 'utf8'), where, { pages: ids });
        const walk = (blocks) => (blocks || []).forEach(b => {
            if (b && b.kind === 'figure' && b.svg) jobs.push({ id, src: b.src, svg: b.svg, where });
            if (b && Array.isArray(b.blocks)) walk(b.blocks);
        });
        walk(page.blocks);
    });
    return jobs;
}

/** 焼く前に見る（外の資産を読まないこと・大きさが在ること） */
function checkSvg(text, file) {
    const bad = [];
    if (/<image\b/i.test(text)) bad.push('<image>（外の画像）');
    if (/@import/i.test(text)) bad.push('@import');
    if (/href\s*=\s*["']https?:/i.test(text)) bad.push('http(s) の参照');
    if (/<script\b/i.test(text)) bad.push('<script>');
    if (bad.length) throw new Error(`${file}: 外の資産を読んでいます（${bad.join(' / ')}）。図は1つのファイルで完結させてください`);
    const w = /<svg[^>]*\swidth\s*=\s*["'](\d+(?:\.\d+)?)/i.exec(text);
    const h = /<svg[^>]*\sheight\s*=\s*["'](\d+(?:\.\d+)?)/i.exec(text);
    if (!w || !h) throw new Error(`${file}: <svg> に width と height（px）がありません（viewBox だけでは大きさが決まりません）`);
    if (Number(w[1]) > MAX_W) throw new Error(`${file}: 幅が ${w[1]}px です（${MAX_W}px 以下にしてください）`);
    return { w: Number(w[1]), h: Number(h[1]) };
}

async function main() {
    const jobs = collect();
    if (!jobs.length) { console.log('svg: の図はありません'); return; }
    if (!existsSync(SVG)) mkdirSync(SVG);

    const missing = [];
    jobs.forEach(j => {
        const p = path.join(SVG, j.svg);
        if (!existsSync(p)) missing.push(`${j.where}: reference-svg/${j.svg} がありません（svg: の図のソース）`);
    });
    if (missing.length) {
        missing.forEach(m => console.error('❌ ' + m));
        process.exit(1);
    }

    if (CHECK) {
        let ng = 0;
        jobs.forEach(j => {
            try { checkSvg(readFileSync(path.join(SVG, j.svg), 'utf8'), j.svg); } catch (e) { console.error('❌ ' + e.message); ng++; }
            if (!existsSync(path.join(IMG, j.src))) { console.error(`❌ ${j.where}: reference-img/${j.src} をまだ焼いていません`); ng++; }
        });
        if (ng) process.exit(1);
        console.log(`✅ ${jobs.length} 枚とも、ソース（reference-svg/）と焼いたもの（reference-img/）がそろっています`);
        return;
    }

    const { chromium } = require('./record/node_modules/playwright');
    const browser = await chromium.launch();
    const small = [];
    const broken = [];
    try {
        for (const j of jobs) {
            const text = readFileSync(path.join(SVG, j.svg), 'utf8');
            const size = checkSvg(text, j.svg);
            const pg = await browser.newPage({ viewport: { width: Math.ceil(size.w), height: Math.ceil(size.h) } });
            try {
                /* ⚠ `file://` で開かない（同じ環境でも相対の参照が効いてしまう）。
                   本文に直接置いて、外を読まない図だけが焼ける状態にする */
                await pg.setContent(`<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:#fff}
svg{display:block;font-family:system-ui,"Segoe UI","Hiragino Sans","Noto Sans JP",sans-serif}</style>
${text}`, { waitUntil: 'load' });
                const el = pg.locator('svg');
                /* ★ 最終的な見た目の字の大きさ（2026-09-24 ユーザー「図表の最低フォントサイズを上げてください」）。
                   図は公開ページで本文の幅 BODY_W（680px）いっぱいに出るので、字 f は f × BODY_W ÷ 図の幅 に見える */
                /* ★ 下付き（添え字）は別の床 MIN_SUB（11px）で見る（2026-09-24 ユーザー「とりあえず11pxでやってみてよさそう」）。
                   下付き ＝ `<text>` の中の `<tspan>` で、親の `<text>` より字が小さいもの。⚠ 別の `<text>` で書いた小さい字は本体として数える（厳しい側） */
                const fonts = await pg.evaluate(() => {
                    let main = Infinity, sub = Infinity;
                    document.querySelectorAll('svg text, svg tspan').forEach(t => {
                        if (![...t.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return;
                        const f = parseFloat(getComputedStyle(t).fontSize);
                        if (!(f > 0)) return;
                        const host = t.tagName.toLowerCase() === 'tspan' ? t.closest('text') : null;
                        const isSub = host && f < parseFloat(getComputedStyle(host).fontSize) - 0.01;
                        if (isSub) { if (f < sub) sub = f; } else if (f < main) main = f;
                    });
                    return { main: isFinite(main) ? main : null, sub: isFinite(sub) ? sub : null };
                });
                const shown = fonts.main ? fonts.main * BODY_W / size.w : null;
                const shownSub = fonts.sub ? fonts.sub * BODY_W / size.w : null;
                const lowMain = shown && shown < MIN_TEXT, lowSub = shownSub && shownSub < MIN_SUB;
                if (lowMain || lowSub) {
                    small.push(`${j.svg}（` + [
                        lowMain ? `字 ${shown.toFixed(1)}px・いちばん小さい字 ${fonts.main}px → ${Math.ceil(MIN_TEXT * size.w / BODY_W)}px 以上に` : '',
                        lowSub ? `下付き ${shownSub.toFixed(1)}px・${fonts.sub}px → ${Math.ceil(MIN_SUB * size.w / BODY_W)}px 以上に` : ''
                    ].filter(Boolean).join('／') + '）');
                }
                /* ★★ 崩れの検査（2026-09-24・Antigravity のスライド図の描き直し29枚のうち約22枚に、端で字が切れる・字が重なる・
                   枠から字がはみ出す、があった。焼く人が目で見落とすので機械で言う）。
                   ① 字が図（viewBox）の外へ出る ② 字どうしが重なる（小さいほうの面積の 25% 以上） ③ 字がそれを囲む枠（rect）からはみ出す
                   ⚠ 見るのは <text> 単位（下付きの <tspan> は親の <text> に含まれる） */
                const layout = await pg.evaluate(() => {
                    const svg = document.querySelector('svg');
                    const sr = svg.getBoundingClientRect();
                    const out = [];
                    const texts = [...svg.querySelectorAll('text')].filter(t => t.textContent.trim())
                        .map(t => ({ t, r: t.getBoundingClientRect(), s: t.textContent.trim().slice(0, 16) }))
                        .filter(o => o.r.width > 0 && o.r.height > 0);
                    const rects = [...svg.querySelectorAll('rect')].map(r => r.getBoundingClientRect())
                        .filter(r => r.width > 8 && r.height > 8 && !(r.width >= sr.width - 2 && r.height >= sr.height - 2));
                    texts.forEach(o => {
                        const r = o.r;
                        if (r.left < sr.left - 1 || r.right > sr.right + 1 || r.top < sr.top - 1 || r.bottom > sr.bottom + 1) {
                            out.push(`図の外へはみ出す「${o.s}」`);
                        }
                        // 字の中心を含む、いちばん小さい枠
                        const cx = (r.left + r.right) / 2, cy = (r.top + r.bottom) / 2;
                        const host = rects.filter(b => cx > b.left && cx < b.right && cy > b.top && cy < b.bottom)
                            .sort((p, q) => p.width * p.height - q.width * q.height)[0];
                        if (host && (r.left < host.left - 2 || r.right > host.right + 2 || r.top < host.top - 3 || r.bottom > host.bottom + 3)) {
                            out.push(`枠からはみ出す「${o.s}」`);
                        }
                    });
                    for (let i = 0; i < texts.length; i++) {
                        for (let k = i + 1; k < texts.length; k++) {
                            const a = texts[i].r, b = texts[k].r;
                            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                            if (w <= 0 || h <= 0) continue;
                            const small = Math.min(a.width * a.height, b.width * b.height);
                            if (w * h > small * 0.25) out.push(`字が重なる「${texts[i].s}」と「${texts[k].s}」`);
                        }
                    }
                    return out;
                });
                if (layout.length) broken.push(`${j.svg}: ${layout.slice(0, 6).join('／')}${layout.length > 6 ? ` ほか ${layout.length - 6} 件` : ''}`);
                const buf = await el.screenshot({ type: 'png' });
                writeFileSync(path.join(IMG, j.src), buf);
                const kb = buf.length / 1024;
                console.log(`   ✅ ${j.src}  ${size.w}x${size.h}  ${kb.toFixed(0)}KB  ← reference-svg/${j.svg}（${j.id}）`
                    + (kb > WARN_BYTES / 1024 ? '  ⚠ 100KB 超' : '')
                    + (shown ? `  字 ${shown.toFixed(1)}px${lowMain ? ' ⚠床' + MIN_TEXT + '未満' : ''}` : '')
                    + (shownSub ? `  下付き ${shownSub.toFixed(1)}px${lowSub ? ' ⚠床' + MIN_SUB + '未満' : ''}` : '')
                    + (layout.length ? `  ⚠崩れ ${layout.length} 件` : ''));
            } finally { await pg.close(); }
        }
    } finally { await browser.close(); }
    console.log(`✅ ${jobs.length} 枚を reference-img/ に焼きました`);
    if (small.length) {
        console.log(`⚠ 字が床（本文の幅 ${BODY_W}px に出したとき 本体 ${MIN_TEXT}px・下付き ${MIN_SUB}px）を下回る図が ${small.length} 枚:`);
        small.forEach(x => console.log('   - ' + x));
    }
    if (broken.length) {
        console.log(`⚠ 崩れのある図が ${broken.length} 枚（字が図の外・字どうしが重なる・字が枠からはみ出す）:`);
        broken.forEach(x => console.log('   - ' + x));
    }
    console.log('   ⚠ 焼いたら**目で見る**（文字が枠からはみ出していないか）。そのあと gen-reference.mjs と gen-reference-pages.mjs');
}

await main();
