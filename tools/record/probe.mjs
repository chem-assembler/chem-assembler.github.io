/**
 * 作図デモの「下見」（無音・無録画。2026-08-12）
 *
 * 台本のアクションだけを fast で流し、**結末の原子・結合・名称・分子式を刷り出す**。
 * 収録（1本ぶん1〜2分）を回す前に、**座標がどこへ落ちたか**と
 * **狙った構造になっているか**を数秒で確かめるための道具。
 *
 * 使い方（リポジトリルートで。静的サーバーが要る）:
 *   node tools/record/probe.mjs --demo=build-thymine
 *   node tools/record/probe.mjs --file=<steps だけの JSON>
 *   node tools/record/probe.mjs --demo=build-thymine --emit > t.json   ← compounds.json 用の target
 *
 * オプション:
 *   --demo   demos-build.json の id
 *   --file   steps 配列だけを書いた JSON（台本にする前の試作に使う）
 *   --base   既定 http://localhost:8123/assembler/
 *   --emit   compounds.json の `target`（atoms / bonds）だけを吐く
 *
 * **なぜ作ったか**（V76〜V84 の9本で分かったこと）:
 *
 *  1. **クリックした座標に原子は落ちない。** ほぼ毎回 28px か 42px の斜めへスナップする。
 *     二重結合にする `clickBond` の中点は**落ちたあとの座標**で計算し直す必要があり、
 *     ずれると「結合が見つかりません」で黙って1手抜ける（`findHitbox` の許容は 14px）。
 *  2. **分子式が合っていても構造が違うことがある。** V82 は下見の段階で
 *     アミドのつもりがエーテルになっていた（酸素を単結合のまま置き、メチル基を O に付けていた）。
 *     アデニンが 2-アミノプリンになっていた事故（2026-08-11）と同じ形なので、
 *     **結合まで刷り出して人が読む**ようにしてある。
 *  3. `--emit` で出した target をそのまま compounds.json に入れれば、
 *     **登録する図と動画で描く図が必ず一致する**（手で座標を写さない）。
 *
 * ⚠ 下見は `wait` と `speed` を飛ばす＝**尺の確認にはならない**。尺はフレーム目視で見ること。
 */
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';

const A = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--'))
    .map(a => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; }));

const base = A.base || 'http://localhost:8123/assembler/';

let steps;
if (A.file) {
    steps = JSON.parse(await readFile(A.file, 'utf8'));
} else {
    const d = JSON.parse(await readFile('assembler/demos-build.json', 'utf8'));
    const demo = d.find(x => x.id === A.demo);
    if (!demo) throw new Error('デモが見つかりません: ' + A.demo);
    steps = demo.steps;
}
const actions = steps.flatMap(s => s.actions || []);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 810, height: 1440 }, hasTouch: true });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto(base + '?mode=free', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.game && window.tutorialPlayer);
await page.waitForTimeout(600);

const log = await page.evaluate(async (acts) => {
    const tp = window.tutorialPlayer;
    tp.speedScale = 1; tp.baseSpeedScale = 1;
    const out = [];
    for (let i = 0; i < acts.length; i++) {
        const a = acts[i];
        if (a.type === 'wait' || a.type === 'speed') continue;
        try {
            await tp.doAction(a, true);
            await new Promise(r => setTimeout(r, 40));
        } catch (e) {
            out.push(`✗ #${i} ${a.type} ${a.x ?? a.selector ?? ''},${a.y ?? ''} → ${e.message}`);
        }
    }
    const mol = window.game.userMolecule;
    const list = [...(mol.atoms || [])];
    const lbl = a => `${a.element}(${Math.round(a.x)},${Math.round(a.y)})`;
    out.push('原子数(重原子): ' + list.length);
    out.push('原子: ' + list.map(lbl).join(' '));
    const byId = Object.fromEntries(list.map(a => [a.id, a]));
    out.push('結合:\n  ' + (mol.bonds || []).map(b => {
        const p = byId[b.atomId1], q = byId[b.atomId2];
        return `${p ? lbl(p) : '?'} ${'-='.charAt((b.type || 1) - 1) || '#'} ${q ? lbl(q) : '?'}`;
    }).join('\n  '));
    out.push('名称: ' + (document.querySelector('#compound-name')?.textContent || '—'));
    out.push('分子式: ' + (document.querySelector('#compound-formula')?.textContent || '—'));
    const idx = Object.fromEntries(list.map((a, i) => [a.id, i]));
    out.push('TARGET' + JSON.stringify({
        atoms: list.map(a => ({ element: a.element, x: Math.round(a.x), y: Math.round(a.y) })),
        bonds: (mol.bonds || []).map(b => ({
            atom1Index: idx[b.atomId1], atom2Index: idx[b.atomId2], type: b.type || 1
        }))
    }));
    return out;
}, actions);

if (A.emit) {
    console.log(JSON.stringify(JSON.parse(log.find(l => l.startsWith('TARGET')).slice(6))));
} else {
    console.log(log.filter(l => !l.startsWith('TARGET')).join('\n'));
}
await browser.close();
