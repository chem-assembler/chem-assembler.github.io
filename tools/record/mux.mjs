/**
 * 収録した映像に音声を載せて mp4 にする（P13-3 / 設計: DESIGN_recording_mode.md §5）
 *
 * ffmpeg は Playwright が同梱しているものを使う（別途インストール不要）。
 *
 * 使い方（リポジトリルートで）:
 *   node tools/record/mux.mjs --video=video-scripts/out/intro-draw-short.webm \
 *                             --audio=video-scripts/audio/v1-zundamon/v1-zundamon-full.wav \
 *                             --out=video-scripts/out/V1-zundamon.mp4
 *
 * オプション:
 *   --video   入力映像（webm）
 *   --audio   入力音声（wav。省略すると無音のまま mp4 化）
 *   --out     出力 mp4
 *   --delay   音声の開始を何秒遅らせるか（既定 0。冒頭の間を作りたいとき）
 *
 * 尺の扱い: 映像と音声の長い方に合わせる（-shortest は付けない）。
 * どちらかが余る場合は台本側（demos.json の wait / narration）で詰めるのが正しい直し方。
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ARGS = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => { const [k, v = '1'] = a.slice(2).split('='); return [k, v]; })
);

/**
 * ffmpeg を探す。
 * **Playwright 同梱の ffmpeg は使えない**（VP8 エンコーダしか持たない簡易ビルドで、
 * H.264/AAC が無く mp4 を作れない。2026-07-29 に実機で確認）。
 * 管理者権限なしでフル機能版を入れる最短手段が imageio-ffmpeg（pip）なので、それを既定で探す。
 *   pip install imageio-ffmpeg
 * 環境変数 FFMPEG で明示指定も可。
 */
function findFfmpeg() {
    if (process.env.FFMPEG) return process.env.FFMPEG;
    // 1) PATH 上の ffmpeg（自前で入れている場合）
    const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['ffmpeg'], { encoding: 'utf8' });
    if (which.status === 0) {
        const p = which.stdout.split('\n')[0].trim();
        if (p && existsSync(p)) return p;
    }
    // 2) imageio-ffmpeg が同梱するフルビルド
    const py = spawnSync('python', ['-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' });
    if (py.status === 0) {
        const p = py.stdout.trim();
        if (p && existsSync(p)) return p;
    }
    return null;
}

const ffmpeg = findFfmpeg();
if (!ffmpeg) {
    console.error('ffmpeg が見つからない。`pip install imageio-ffmpeg` を実行するか、環境変数 FFMPEG で場所を指定する');
    console.error('（Playwright 同梱の ffmpeg は VP8 専用で mp4 を作れないため使わない）');
    process.exit(1);
}

const video = ARGS.video;
const audio = ARGS.audio;
const out = ARGS.out || (video ? video.replace(/\.webm$/, '.mp4') : null);
if (!video || !out) {
    console.error('--video と --out は必須');
    process.exit(1);
}

const delay = parseFloat(ARGS.delay || '0');
const args = ['-y', '-i', video];
if (audio) args.push(...(delay > 0 ? ['-itsoffset', String(delay)] : []), '-i', audio);
// --size=1080x1920 で最終解像度を指定できる（既定は入力のまま偶数に丸めるだけ）。
// short は 810x1440 で収録し、ここで 1080x1920 へ拡大するのが標準の流れ（record.mjs 参照）
const vf = ARGS.size && /^\d+x\d+$/.test(ARGS.size)
    ? `scale=${ARGS.size.replace('x', ':')}:flags=lanczos`
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';
args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    // SNSプレイヤーの互換性: yuv420p と偶数解像度が要る
    '-pix_fmt', 'yuv420p',
    '-vf', vf,
    '-r', '30',
);
if (audio) args.push('-c:a', 'aac', '-b:a', '192k', '-map', '0:v:0', '-map', '1:a:0');
args.push(out);

console.log(`[mux] ffmpeg: ${ffmpeg}`);
const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-15).join('\n'));
    process.exit(r.status || 1);
}
console.log(`[mux] 出力: ${out}`);
