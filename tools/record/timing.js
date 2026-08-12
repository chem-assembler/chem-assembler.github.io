/**
 * テロップとナレーションのずれを実測して、`wait` の直し値を出す（2026-08-12）
 *
 *   node tools/record/timing.js <ID> <demo-id> [--speed=2]
 *   node tools/record/timing.js V84 build-vanillin
 *
 * **なぜ必要か**: `wait` は「行の秒数 × 2000 −（操作の実測コスト）」で組むが、
 * この“操作のコスト”は見積もりなので、手数の多い回ほどずれが積もる
 * （2026-08-12 のユーザー検品で V81・V82 が「全体的にずれている」と指摘された）。
 * **収録した events.json には本物の時刻が入っている**ので、
 * そこから1ステップずつ実測して差を出せば、見積もりに頼らずに直せる。
 *
 * 見方:
 *   実測 … 収録で、そのステップが始まってから次が始まるまでの秒数
 *   目標 … ナレーションのその行の長さ ＋ 行間の無音 0.6秒
 *   ずれ … 実測 − 目標。**プラスなら画が遅い**（テロップが長く出すぎ）
 *   直し … `wait` をいくつにすればよいか（speed で割られるぶんを戻した値）
 *
 * ⚠ 最終ステップは音より長く出すのが正しい（LANES.md §4-7b）ので直さない。
 */
const fs = require('fs');
const path = require('path');

const [id, demo] = process.argv.slice(2).filter(a => !a.startsWith('--'));
const speed = Number((process.argv.find(a => a.startsWith('--speed=')) || '--speed=2').split('=')[1]);
if (!id || !demo) { console.error('使い方: node tools/record/timing.js <ID> <demo-id>'); process.exit(1); }

const events = JSON.parse(fs.readFileSync(path.join('video-scripts', 'out', `${demo}-short.events.json`), 'utf8'));
const demos = JSON.parse(fs.readFileSync(path.join('assembler', 'demos-build.json'), 'utf8'));
const d = demos.find(x => x.id === demo);
if (!d) { console.error('デモが見つかりません: ' + demo); process.exit(1); }

// ナレーションの各行の長さ（wav から）
const lines = JSON.parse(fs.readFileSync(path.join('video-scripts', 'narration', `${id}.json`), 'utf8'));
const wavSec = name => {
    const b = fs.readFileSync(path.join('video-scripts', 'audio', id, `${name}.wav`));
    // 44バイトの標準ヘッダを前提にせず、data チャンクを探す
    let p = 12, rate = 0, bytes = 0, blockAlign = 0;
    while (p + 8 <= b.length) {
        const tag = b.toString('ascii', p, p + 4), size = b.readUInt32LE(p + 4);
        if (tag === 'fmt ') { rate = b.readUInt32LE(p + 12); blockAlign = b.readUInt16LE(p + 20); }
        if (tag === 'data') { bytes = size; break; }
        p += 8 + size + (size % 2);
    }
    return bytes / (rate * blockAlign);
};
const dur = lines.map(l => wavSec(l.name));

// ステップごとの開始時刻を拾う。
// ⚠ **`wait` で切ってはいけない**——古い台本はステップの途中にも `wait` を持っている
//（V71 は7ステップなのに wait が11個あった）。**台本の手数どおりに events を食う**のが正しい。
const starts = [];
let k = 0;
for (const st of d.steps) {
    if (k >= events.length) break;
    starts.push(events[k].at);
    k += st.actions.length;
}
if (k < events.length) starts.push(events[k].at);
else if (events.length) starts.push(events[events.length - 1].at + (d.steps.at(-1).actions.at(-1).ms || 0) / 1000 / speed);

console.log(`${id} / ${demo}（--speed=${speed}）`);
console.log('  # 行           実測    目標    ずれ    いまの wait → 直し');
const fixes = [];
for (let i = 0; i < d.steps.length; i++) {
    const w = d.steps[i].actions.at(-1);
    const now = w && w.type === 'wait' ? w.ms : 0;
    if (i >= starts.length - 1) { console.log(`  ${String(i + 1).padStart(2)} ${lines[i]?.name || ''} 最終ステップは直さない（音より長く出すのが正しい）`); fixes.push(now); continue; }
    const measured = starts[i + 1] - starts[i];
    const target = dur[i] + 0.6;
    const drift = measured - target;
    const fixed = Math.max(400, Math.round(now - drift * 1000 * speed));
    fixes.push(fixed);
    const mark = Math.abs(drift) >= 0.25 ? (drift > 0 ? ' ←画が遅い' : ' ←画が早い') : '';
    console.log(`  ${String(i + 1).padStart(2)} ${(lines[i]?.name || '').padEnd(12)} ${measured.toFixed(2)}  ${target.toFixed(2)}  ${drift >= 0 ? '+' : ''}${drift.toFixed(2)}  ${String(now).padStart(6)} → ${String(fixed).padStart(6)}${mark}`);
}
console.log('FIXES ' + JSON.stringify(fixes));
