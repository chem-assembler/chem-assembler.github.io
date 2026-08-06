#!/usr/bin/env node
/**
 * PC 幅の可視域検査（tools/check-mobile.mjs の対になる道具）
 *
 * ■ なぜ要るか
 * v771（リボン統合 第5段）で `#summon-input` を右パネルから作業帯（`#work-strip`）へ移した
 * とき、**PC 幅でだけ作業帯が可視域の下へ落ちて到達不能になった**（v866 で修正）。
 * 誰も気づかなかったのは、自動検査が `tools/check-mobile.mjs`（モバイル20端末）しか
 * 無かったからで、**モバイルだけ見る検査では PC の退行は捕まらない**。
 * その穴を塞ぐのがこの道具。
 *
 * ■ 何を見るか
 * 主要な PC 幅 × 作業帯の3面（🧪自由・🧩パズル・⚗反応機構）で、
 *   ① リボン（.canvas-header）  ② キャンバス（#svg-wrapper）  ③ 作業帯（#work-strip）
 * の **getBoundingClientRect() が可視域に収まっている**ことを確かめる。
 * `display` や `.hidden` を見るだけでは、いままさに素通りした形（描画はされているが
 * 画面の外）を捕まえられない ＝ **矩形で数える**のが要点。
 * あわせて「本体に横スクロールが出ていないか」も見る。
 *
 * ■ 使い方
 *   node tools/check-desktop.mjs [URL]
 *   （既定は http://localhost:8134/assembler/ ）
 * 落ちたら終了コード 1。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Playwright は tools/record/ のものを借りる（追加インストール不要）。
 *  ⚠ node_modules は追跡外なので **git worktree には無い**。並行レーンで走らせるため、
 *  見つからなければ本体の作業ツリー（git worktree list の先頭）を当たり直す。 */
function loadPlaywright() {
    const roots = [ROOT];
    try {
        const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
        const first = out.split('\n').find(l => l.startsWith('worktree '));
        if (first) roots.push(first.slice('worktree '.length).trim());
    } catch (e) { /* git が無くても本筋は動く */ }
    for (const r of roots) {
        try { return createRequire(path.join(r, 'tools/record/')).call(null, 'playwright'); } catch (e) { /* 次を試す */ }
    }
    console.error('Playwright が見つかりません。tools/record で `npm install` を1度だけ実行してください。');
    process.exit(1);
}
const { chromium } = loadPlaywright();

const url = process.argv[2] || 'http://localhost:8134/assembler/';

/** 見る PC 幅。ノートの定番（1280/1366/1440/1536）＋ 大画面（1920/2560）＋
 *  タブレット横（1024）。900px はリボンが 9 枠で成立する床（style.css の注）なので入れる。 */
const SIZES = [
    [900, 700], [1024, 768], [1280, 800], [1366, 768],
    [1440, 900], [1536, 864], [1920, 1080], [1920, 1200], [2560, 1440],
];

/** 作業帯の3面。`enter` はページ内で走らせて面を出す手順。 */
const PANES = [
    { id: 'ws-free', label: '🧪自由', enter: () => { window.game.setMode('free'); } },
    {
        id: 'ws-puzzle', label: '🧩パズル', enter: () => {
            window.game.setMode('puzzle');
            // モードに入るとお題選択のモーダルが開く。帯を測るので閉じておく
            const m = document.getElementById('puzzle-modal');
            if (m) m.classList.add('hidden');
        }
    },
    {
        id: 'ws-reaction', label: '⚗反応機構', enter: () => {
            window.game.setMode('learn');
            const m = document.getElementById('study-modal');
            if (m) m.classList.add('hidden');
            if (window.reactionPlayer) window.reactionPlayer.enter(0);
        }
    },
];

/** 可視域に収まっているか（矩形で数える）。誤差 1px は許す（端数丸め）。 */
const TOL = 1;

let ng = 0;
let checks = 0;
const browser = await chromium.launch();

for (const [w, h] of SIZES) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(600);

    for (const pane of PANES) {
        await page.evaluate(pane.enter);
        await page.waitForTimeout(350);
        const r = await page.evaluate(({ paneId, tol }) => {
            const rect = (el) => {
                if (!el) return null;
                const b = el.getBoundingClientRect();
                return { x: b.x, y: b.y, w: b.width, h: b.height, top: b.top, bottom: b.bottom, left: b.left, right: b.right };
            };
            const inView = (b) => b && b.h > 0 && b.w > 0 &&
                b.top >= -tol && b.bottom <= innerHeight + tol &&
                b.left >= -tol && b.right <= innerWidth + tol;
            const strip = document.getElementById('work-strip');
            const paneEl = document.getElementById(paneId);
            const ribbon = document.querySelector('.canvas-header');
            const canvas = document.getElementById('svg-wrapper');
            const bStrip = rect(strip), bPane = rect(paneEl), bRibbon = rect(ribbon), bCanvas = rect(canvas);

            /* 「押せるものが画面の外に出ていない」を面で見る。
               ⚠ **除外は「見かけ」ではなく「理由」で書く。**
                  「id が○○なら」「幅が○px 以上なら」で除くと、通りはするが**本物の退行も
                  一緒に消える**。ここで除いてよいのは理由のある2つだけ:
                    ① 祖先に**実際にスクロールする器**があり、その器自身は画面内にある
                       …… 器の中で送るのは設計どおり（#left-panel など）。
                          「スクロールできる」だけでなく「本当にはみ出している」ことまで見る
                    ② `position: fixed` の浮動ボタン（☰ など）
                       …… 通常フローに乗っておらず、列の高さの話と無関係 */
            const 画面外 = [];
            let 押しもの = 0;
            document.querySelectorAll('button, input, select, a, summary, [role=button]').forEach(el => {
                const b = el.getBoundingClientRect();
                if (b.width < 1 || b.height < 1) return;
                const cs = getComputedStyle(el);
                if (cs.visibility === 'hidden' || cs.display === 'none') return;
                if (cs.position === 'fixed') return;                       // 除外②
                押しもの++;
                if (b.top >= -tol && b.bottom <= innerHeight + tol &&
                    b.left >= -tol && b.right <= innerWidth + tol) return;
                let p = el.parentElement, 器 = null;
                while (p && p !== document.documentElement) {
                    const pcs = getComputedStyle(p);
                    if ((/(auto|scroll)/.test(pcs.overflowY) && p.scrollHeight > p.clientHeight + 1) ||
                        (/(auto|scroll)/.test(pcs.overflowX) && p.scrollWidth > p.clientWidth + 1)) { 器 = p; break; }
                    p = p.parentElement;
                }
                if (器) {                                                   // 除外①
                    const kb = 器.getBoundingClientRect();
                    if (kb.top >= -tol && kb.bottom <= innerHeight + tol &&
                        kb.left >= -tol && kb.right <= innerWidth + tol) return;
                }
                画面外.push(`${el.id || el.className || el.tagName}:${Math.round(b.left)},${Math.round(b.top)}`);
            });

            return {
                帯: { b: bStrip, ok: inView(bStrip), 隠し: !strip || strip.classList.contains('hidden') },
                面: { b: bPane, ok: inView(bPane), 隠し: !paneEl || paneEl.classList.contains('hidden') },
                リボン: { b: bRibbon, ok: inView(bRibbon) },
                キャンバス: { b: bCanvas, ok: inView(bCanvas), 面積: bCanvas ? Math.round(bCanvas.w * bCanvas.h) : 0 },
                押しもの: { 数: 押しもの, 画面外 },
                横スクロール: document.documentElement.scrollWidth > innerWidth + tol,
            };
        }, { paneId: pane.id, tol: TOL });

        const problems = [];
        if (r.帯.隠し) problems.push('帯が hidden のまま');
        else if (!r.帯.ok) problems.push(`帯が可視域外（y=${Math.round(r.帯.b.y)} bottom=${Math.round(r.帯.b.bottom)} / 画面高=${h}）`);
        if (r.面.隠し) problems.push(`${pane.id} が hidden のまま`);
        else if (!r.面.ok) problems.push(`${pane.id} が可視域外（bottom=${Math.round(r.面.b.bottom)}）`);
        if (!r.リボン.ok) problems.push(`リボンが可視域外（bottom=${Math.round(r.リボン.b?.bottom ?? -1)}）`);
        if (!r.キャンバス.ok) problems.push(`キャンバスが可視域外（bottom=${Math.round(r.キャンバス.b?.bottom ?? -1)}）`);
        if (r.横スクロール) problems.push('本体に横スクロールが出ている');
        // 空振りの緑を弾く（走査が0件なら「画面外は0件」は何も主張していない）
        if (r.押しもの.数 < 10) problems.push(`見えている押しものが ${r.押しもの.数} 個しか無い（走査が空振り）`);
        else if (r.押しもの.画面外.length) {
            problems.push(`画面外の押しもの ${r.押しもの.画面外.length} 件 —— ${r.押しもの.画面外.slice(0, 5).join(' / ')}`);
        }

        checks++;
        const head = `${String(w).padStart(4)}x${String(h).padStart(4)} ${pane.label}`;
        if (problems.length) {
            ng++;
            console.log(`  ✗ ${head}  ${problems.join(' / ')}`);
        } else {
            console.log(`  ✓ ${head}  帯 y=${Math.round(r.帯.b.y)} h=${Math.round(r.帯.b.h)} / キャンバス ${Math.round(r.キャンバス.b.w)}x${Math.round(r.キャンバス.b.h)}（${r.キャンバス.面積.toLocaleString()}px²）/ 押しもの ${r.押しもの.数} 個すべて画面内`);
        }
    }
    await page.close();
}
await browser.close();

console.log('');
console.log(`PC 幅の可視域検査: ${checks - ng} / ${checks} 合格（${SIZES.length} サイズ × ${PANES.length} 面）`);
if (ng) {
    console.log(`✗ ${ng} 件が可視域から外れています。`);
    process.exit(1);
}
console.log('✓ すべて可視域に収まっています。');
