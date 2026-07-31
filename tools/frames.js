/**
 * 完成した mp4 から確認用の静止画を抜く（2026-08-01）
 *
 * 使い方（リポジトリルートで）:
 *   node tools/frames.js video-scripts/out/V6-final.mp4 2 8 13 19 26
 *   node tools/frames.js video-scripts/out/V6-final.mp4 --every=5
 *   node tools/frames.js video-scripts/out/V6-final.mp4 --steps    ← テロップを取りこぼさない位置を自動で選ぶ
 *
 * オプション:
 *   --out=<dir>   出力先（既定: <mp4と同じ場所>/frames/<ID>）
 *   --width=<px>  横幅（既定 405。目視確認には十分で、読み込みも速い）
 *   --every=<秒>  指定秒ごとに抜く
 *   --steps       events.json があれば、待ちの切れ目ごとに中間時刻を選ぶ（テロップを全部拾える）
 *
 * **なぜ専用スクリプトにしたか**: 公開前のフレーム目視は毎回やる作業なのに、
 * ffmpeg の実体パスが imageio-ffmpeg の中にあるため、呼び出しが毎回違う長い1行になっていた。
 * コマンドの形が毎回変わると許可リストに載せられず、そのたびに承認を求めることになる。
 * **形が一定のコマンドにするのが、承認を減らすいちばん確実な方法**（.claude/settings.json 参照）。
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const video = args.find(a => !a.startsWith('--'));
if (!video || !fs.existsSync(video)) {
    console.error('mp4 のパスを指定してください（例: node tools/frames.js video-scripts/out/V6-final.mp4 2 8 13）');
    process.exit(1);
}
const opt = (name, def) => {
    const hit = args.find(a => a.startsWith(`--${name}=`));
    return hit ? hit.split('=')[1] : def;
};

// ffmpeg は mux.mjs と同じ探し方（PATH → imageio-ffmpeg）
function findFfmpeg() {
    if (process.env.FFMPEG) return process.env.FFMPEG;
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    if (which.status === 0) {
        const p = which.stdout.split('\n')[0].trim();
        if (p && fs.existsSync(p)) return p;
    }
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
    if (py.status === 0) {
        const p = py.stdout.trim();
        if (p && fs.existsSync(p)) return p;
    }
    return null;
}
const ffmpeg = findFfmpeg();
if (!ffmpeg) {
    console.error('ffmpeg が見つかりません。`pip install imageio-ffmpeg` を実行してください');
    process.exit(1);
}

const id = path.basename(video).replace(/-final\.mp4$/, '').replace(/\.mp4$/, '');
const outDir = opt('out', path.join(path.dirname(video), 'frames', id));
const width = parseInt(opt('width', '405'), 10);

// 尺を測る（--every / --steps の範囲決めに使う）
const probe = spawnSync(ffmpeg, ['-i', video], { encoding: 'utf8' });
const m = (probe.stderr || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
const duration = m ? (+m[1]) * 3600 + (+m[2]) * 60 + parseFloat(m[3]) : 0;

let times = args.filter(a => !a.startsWith('--') && a !== video).map(Number).filter(t => !isNaN(t));

const every = opt('every', null);
if (every) {
    times = [];
    for (let t = 1; t < duration; t += parseFloat(every)) times.push(+t.toFixed(1));
}

if (args.includes('--steps')) {
    // 収録時の events.json（各アクションの実時刻）から、`wait` の切れ目ごとに中間時刻を選ぶ。
    // ステップの先頭は必ずこの切れ目なので、**テロップを1枚も取りこぼさない**。
    // ステップ内にも `wait` があると多めに出るが、確認用なので余るぶんには困らない
    const dir = path.dirname(video);
    const ev = fs.readdirSync(dir).filter(f => f.endsWith('.events.json'));
    let picked = null;
    for (const f of ev) {
        const list = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        if (!list.length) continue;
        const trim = Math.max(0, list[0].at - 0.3);   // mux の --lead=0.3 と同じ前提
        const starts = list.filter((e, i) => i === 0 || list[i - 1].type === 'wait').map(e => +(e.at - trim).toFixed(2));
        if (!starts.length) continue;
        const cand = starts.map((s, i) => {
            const end = (i + 1 < starts.length) ? starts[i + 1] : duration;
            return +((s + end) / 2).toFixed(1);
        }).filter(t => t > 0 && t < duration);
        if (!picked || cand.length > picked.length) picked = cand;
    }
    if (picked) times = picked;
    else console.warn('[frames] events.json が見つからないので --steps は無視します');
}

if (!times.length) {
    console.error('抜く秒数を指定してください（秒を並べる / --every=5 / --steps）');
    process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
for (const t of times) {
    const out = path.join(outDir, `${id}-${String(t).replace('.', '_')}s.png`);
    const r = spawnSync(ffmpeg, ['-v', 'error', '-ss', String(t), '-i', video,
        '-frames:v', '1', '-vf', `scale=${width}:-1`, '-y', out], { encoding: 'utf8' });
    if (r.status !== 0) console.error(`  ${t}s: 失敗 ${r.stderr || ''}`);
    else console.log(`  ${t}s → ${out}`);
}
console.log(`[frames] ${times.length} 枚（尺 ${duration.toFixed(1)}秒）`);
