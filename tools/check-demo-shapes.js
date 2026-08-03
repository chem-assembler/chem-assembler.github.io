/**
 * デモの `state` に手で書いた構造式が、名称ライブラリの図とずれていないか調べる。
 *
 *   node tools/check-demo-shapes.js [--base=http://localhost:8123/assembler/]
 *
 * **なぜ要るか**（2026-08-03・V31 で実際に踏んだ）:
 * `state` を積むデモは compounds.json も stages.json も**一切見ない**。
 * そのため**アプリ側で構造式を直しても、その回だけ古い図が残る**。
 * しかも名称チップは結合から計算されるので**正しい名前が出てしまい、目でも気づけない**。
 * 実例: C-4b でアミノ酸の主鎖を一直線に直した（v345）のに、V31 のデモは
 * アミノ基が斜めのまま残っていた（ユーザーの検品で発覚）。
 *
 * **判定の仕方**: 結合ベクトルの多重集合を最頻結合長で割って比べる。
 * 平行移動と拡大縮小には目をつぶり（間隔を広げるのは正当な調整なので）、
 * **回転と鏡映は「一致」ではなく種類を出す**。
 * - **回転** … たいてい無害（六角形の向きが違う程度）
 * - **鏡映** … **不斉炭素があると別の立体異性体になる**ので必ず中身を見る
 *   （立体シリーズの乳酸はフィッシャー投影を縦に置くのが仕様なので、鏡映が出るのは正しい）
 * - **形が違う** … 回転でも鏡映でも重ならない ＝ 手で別の図を描いている。**直す対象**
 *
 * ローカルサーバが動いている必要がある（既定 8123）。
 */
// playwright は収録ツール側にだけ入れてある（tools/record/node_modules）
const path = require('path');
const { chromium } = (() => {
    try { return require('playwright'); } catch (e) { /* 下で探す */ }
    try { return require(path.join(__dirname, 'record', 'node_modules', 'playwright')); }
    catch (e) {
        console.error('playwright が見つかりません。`cd tools/record && npm install` を実行してください');
        process.exit(1);
    }
})();

const base = (process.argv.find(a => a.startsWith('--base=')) || '').slice(7)
    || 'http://localhost:8123/assembler/';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    try {
        await page.goto(base, { waitUntil: 'load', timeout: 30000 });
        await page.waitForFunction(() => window.game && window.loadAllDemos, null, { timeout: 60000 });
    } catch (e) {
        console.error(`アプリを開けません（${base}）。ローカルサーバを立ててから実行してください`);
        console.error(e.message);
        await browser.close();
        process.exit(1);
    }

    const rows = await page.evaluate(async () => {
        const demos = await window.loadAllDemos();
        const g = window.game;

        // 名称 → target（原子と結合）の索引。stages.json を先に引く game 側と同じ優先順にする
        const lib = new Map();
        const add = (list) => {
            for (const e of (list || [])) if (e && e.name && e.target && !lib.has(e.name)) lib.set(e.name, e.target);
        };
        add(await (await fetch('compounds.json')).json());
        const st = await (await fetch('stages.json')).json();
        add(Array.isArray(st) ? st : (st.stages || st.compounds));

        // 結合ベクトル（最頻結合長で正規化）。異種原子はアルファベット順に、
        // 同種原子（C-C など）は辞書順で符号を固定する＝結合の記録順に依存しないようにする
        const vecs = (atoms, bonds) => {
            const vs = [];
            for (const bd of bonds) {
                const q = atoms[bd.atom1Index], w = atoms[bd.atom2Index];
                if (!q || !w) continue;
                let dx = w.x - q.x, dy = w.y - q.y, e1 = q.element, e2 = w.element;
                if (e1 === e2) {
                    if (dx < -1e-6 || (Math.abs(dx) < 1e-6 && dy < 0)) { dx = -dx; dy = -dy; }
                } else if (e1 > e2) { dx = -dx; dy = -dy; const t = e1; e1 = e2; e2 = t; }
                vs.push([dx, dy, e1 + e2]);
            }
            const lens = vs.map(v => Math.hypot(v[0], v[1])).filter(x => x > 0).sort((a, b) => a - b);
            const u = lens[Math.floor(lens.length / 2)] || 1;
            return vs.map(v => [v[0] / u, v[1] / u, v[2]]);
        };
        const key = vs => vs.map(v => {
            let dx = v[0], dy = v[1];
            if (v[2][0] === v[2][1]) {
                if (dx < -1e-6 || (Math.abs(dx) < 1e-6 && dy < 0)) { dx = -dx; dy = -dy; }
            }
            return [Math.round(dx * 20) / 20, Math.round(dy * 20) / 20, v[2]].join(',');
        }).sort().join('|');
        const xform = (vs, deg, mir) => {
            const t = deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
            return vs.map(v => { const x = mir ? -v[0] : v[0]; return [x * c - v[1] * s, x * s + v[1] * c, v[2]]; });
        };

        const res = [];
        for (const d of demos) {
            if (!d.state) continue;
            g.restoreState(JSON.parse(JSON.stringify(d.state)));
            for (const m of g.splitMolecules()) {
                const name = g.lookupCompoundName(m);
                const libT = name && lib.get(name);
                if (!libT) { res.push({ demo: d.id, name: name || '（該当なし）', v: '照合できない' }); continue; }
                const A = m.atoms.filter(a => a.element !== 'H');
                const ids = new Set(A.map(a => a.id));
                const bds = m.bonds.filter(b => ids.has(b.atomId1) && ids.has(b.atomId2))
                    .map(b => ({ atom1Index: A.findIndex(a => a.id === b.atomId1), atom2Index: A.findIndex(a => a.id === b.atomId2) }));
                const dv = vecs(A, bds), lv = key(vecs(libT.atoms, libT.bonds));
                let v = '⚠ 形が違う';
                if (key(dv) === lv) v = '一致';
                else outer: for (const deg of [30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 0]) {
                    for (const mir of [false, true]) {
                        if (deg === 0 && !mir) continue;
                        if (key(xform(dv, deg, mir)) === lv) { v = (mir ? '⚠ 鏡映' : '回転') + deg + '°'; break outer; }
                    }
                }
                res.push({ demo: d.id, name, v });
            }
        }
        return res;
    });

    await browser.close();

    const width = Math.max(...rows.map(r => r.demo.length), 10);
    for (const r of rows) console.log(r.v.padEnd(12) + ' ' + r.demo.padEnd(width) + ' ' + r.name);

    const diff = rows.filter(r => r.v.startsWith('⚠ 形'));
    const mirror = rows.filter(r => r.v.startsWith('⚠ 鏡映'));
    const skip = rows.filter(r => r.v === '照合できない');
    console.log(`\n${rows.length} 分子を照合: 一致・回転 ${rows.length - diff.length - mirror.length - skip.length} / ` +
        `鏡映 ${mirror.length} / 形が違う ${diff.length} / 照合できない ${skip.length}`);
    if (mirror.length) console.log('※ 鏡映は不斉炭素があると別の立体異性体になる。立体シリーズは縦置きが仕様なので出て正しい');
    if (diff.length) {
        console.log('\n❌ ライブラリと違う図を手で描いている（直す対象）:\n' +
            diff.map(r => `  - ${r.demo} の ${r.name}`).join('\n'));
        process.exit(1);
    }
    console.log('\n✅ 手描きの図とライブラリの食い違いはありません');
})();
