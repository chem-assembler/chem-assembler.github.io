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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
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

/** ffmpeg に読ませて尺（秒）を得る */
function durationOf(file) {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-i', file], { encoding: 'utf8' });
    const m = (r.stderr || '').match(/Duration: (\d+):(\d+):(\d+\.\d+)/);
    return m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null;
}

const bgm = ARGS.bgm;                        // BGM（ループして敷く。既定 -20dB）
const se = ARGS.se;                          // 効果音（操作のたびに鳴らす）
const events = ARGS.events;                  // record.mjs が出す events.json
const bgmDb = ARGS.bgmdb || '-20';           // BGM の音量（dB）
const seDb = ARGS.sedb || '-8';              // SE の音量（dB）

const delay = parseFloat(ARGS.delay || '0') || 0;   // 音声の開始を遅らせる（手で決めるとき用）

/**
 * 頭合わせ。**同じ台本でも収録ごとに「演技が始まるまで」が3〜4秒ぶれる**
 * （アプリのロード時間。演技そのもののテンポはぶれない。2026-07-31 実測）。
 * そのまま繋ぐと、頭の静止画が長い動画になり、ナレーションも同じだけズレる。
 * `--trim=auto`（--events が要る）で **最初の操作の `--lead` 秒前まで映像の頭を切り落とす**。
 * ショートは最初の1秒が勝負なので、音声を遅らせるのではなく映像を詰めるほうを既定にする。
 */
let trim = parseFloat(ARGS.trim || '0') || 0;
if (ARGS.trim === 'auto') {
    const first = events ? (JSON.parse(readFileSync(events, 'utf8'))[0] || {}).at : null;
    // 既定 1.5秒。ショートは頭が勝負なので、空のキャンバスを長く見せない
    const lead = parseFloat(ARGS.lead || '1.5');
    trim = (first != null) ? Math.max(0, +(first - lead).toFixed(2)) : 0;
    console.log(`[mux] 頭合わせ: 最初の操作 ${first}秒 − 先行 ${lead}秒 → 映像の頭 ${trim}秒 を落とす`);
}

const args = ['-y', ...(trim > 0 ? ['-ss', String(trim)] : []), '-i', video];
if (audio) args.push(...(delay > 0 ? ['-itsoffset', String(delay)] : []), '-i', audio);
// BGM は動画より短いことが多いのでループさせる（-stream_loop は入力の前に置く）
if (bgm) args.push('-stream_loop', '-1', '-i', bgm);
if (se && events) args.push('-i', se);

/**
 * 音声の合成フィルタを組む。
 *  - ナレーションはそのまま
 *  - BGM は -20dB 程度まで下げ、さらに sidechaincompress でナレーション中だけ自動的に沈ませる
 *    （ダッキング。声とBGMがぶつかって聞き取りにくくなるのを防ぐ）
 *  - SE は events.json の時刻ごとに adelay で配置して足し合わせる
 */
function buildAudioFilter() {
    if (!audio && !bgm) return null;
    const parts = [];
    const mixIn = [];
    let idx = 1;                      // 0 は映像
    let narr = null;
    if (audio) { narr = `${idx}:a`; idx++; }
    let bgmIdx = null;
    if (bgm) { bgmIdx = idx; idx++; }
    const seIdx = (se && events) ? idx : null;

    if (narr) { parts.push(`[${narr}]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo[narr]`); mixIn.push('[narr]'); }
    if (bgmIdx !== null) {
        parts.push(`[${bgmIdx}:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,volume=${bgmDb}dB[bgmraw]`);
        if (narr) {
            // ナレーションを鍵にして BGM を沈ませる
            parts.push(`[narr]asplit=2[narrmix][narrkey]`);
            parts.push(`[bgmraw][narrkey]sidechaincompress=threshold=0.03:ratio=6:attack=20:release=400[bgm]`);
            mixIn[mixIn.indexOf('[narr]')] = '[narrmix]';
        } else {
            parts.push(`[bgmraw]anull[bgm]`);
        }
        mixIn.push('[bgm]');
    }
    if (seIdx !== null) {
        // 効果音の位置は収録時の時刻なので、頭を落としたぶんだけ手前へ寄せる
        const list = JSON.parse(readFileSync(events, 'utf8'))
            .filter(e => ['click', 'clickBond', 'button', 'undo'].includes(e.type))
            .map(e => ({ ...e, at: e.at - trim }))
            .filter(e => e.at >= 0);
        if (list.length) {
            // **入力ストリームは1回しか参照できない**ので、鳴らす回数だけ asplit で複製する
            // （複製せずに [N:a] を繰り返し書くと "unconnected output" で落ちる。2026-07-29 実測）
            const labels = list.map((_, i) => `[sesrc${i}]`).join('');
            parts.push(`[${seIdx}:a]asplit=${list.length}${labels}`);
            list.forEach((e, i) => {
                const ms = Math.max(0, Math.round(e.at * 1000));
                parts.push(`[sesrc${i}]adelay=${ms}|${ms},volume=${seDb}dB[se${i}]`);
                mixIn.push(`[se${i}]`);
            });
        }
        console.log(`[mux] SE ${list.length} 箇所`);
    }
    if (!mixIn.length) return null;
    parts.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:duration=first:normalize=0,alimiter=limit=0.95[aout]`);
    return parts.join(';');
}
// --size=1080x1920 で最終解像度を指定できる（既定は入力のまま偶数に丸めるだけ）。
// short は 810x1440 で収録し、ここで 1080x1920 へ拡大するのが標準の流れ（record.mjs 参照）
let vf = ARGS.size && /^\d+x\d+$/.test(ARGS.size)
    ? `scale=${ARGS.size.replace('x', ':')}:flags=lanczos`
    : 'scale=trunc(iw/2)*2:trunc(ih/2)*2';

/**
 * 尺を合わせる。**映像がナレーションより短いと最後の一言が切れる**（2026-07-29 実測）ので、
 * 足りない分は最終フレームを静止させて埋める。
 * 逆に**映像のほうが長いと、喋り終わったあとの無音が尻に残る**（収録の停止処理ぶん）。
 * `--tail`（既定1.0秒）で、ナレーションが終わってからの余韻をその長さに切りそろえる。
 */
const vDur = durationOf(video) - trim;   // 頭を落とした後の実尺
const aDur = audio ? durationOf(audio) + delay : 0;
const tail = parseFloat(ARGS.tail ?? '1.0');
let target = Math.max(vDur || 0, aDur || 0);
if (aDur && vDur && vDur > aDur + tail) {
    target = aDur + tail;
    console.log(`[mux] 尻の無音 ${(vDur - target).toFixed(2)}秒 を切る（--tail=${tail}）`);
}
if (vDur && target > vDur + 0.05) {
    vf += `,tpad=stop_mode=clone:stop_duration=${(target - vDur).toFixed(2)}`;
    console.log(`[mux] 映像を ${(target - vDur).toFixed(2)}秒 静止で延長（音声の尻切れ防止）`);
}
/**
 * クレジットを映像に焼き込む（--credit。省略時は --meta の credits を使う）。
 * **VOICEVOX は「利用したことがわかるクレジット表記」を公開のたびに求める**ので、
 * 投稿文だけに頼ると媒体を増やすたびに書き漏れる。映像に入れておけば転載されても外れない。
 * 位置は下部パレットのすぐ上・右寄せ（被写体と字幕を避ける。縦横どちらの比でも成り立つ相対指定）。
 */
const credit = ARGS.credit || (ARGS.meta ? (JSON.parse(readFileSync(ARGS.meta, 'utf8')).credits || []).join(' / ') : '');
if (credit) {
    // フィルタ表記の中では : と ' と \ と % が特別扱いなので、値をエスケープしてから埋める
    const esc = (s) => String(s).replace(/\\/g, '/').replace(/([:'%])/g, '\\$1');
    const font = ARGS.creditfont || 'C:/Windows/Fonts/YuGothR.ttc';
    const size = ARGS.creditsize || '24';
    vf += `,drawtext=fontfile='${esc(font)}':text='${esc(credit)}':fontsize=${size}` +
          `:fontcolor=white@0.62:x=w-tw-32:y=h*0.885:shadowcolor=black@0.8:shadowx=1:shadowy=1`;
    console.log(`[mux] クレジット焼き込み: ${credit}`);
}

const af = buildAudioFilter();
args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20',
    // SNSプレイヤーの互換性: yuv420p と偶数解像度が要る
    '-pix_fmt', 'yuv420p',
    '-vf', vf,
    '-r', '30',
);
if (af) {
    args.push('-filter_complex', af, '-map', '0:v:0', '-map', '[aout]',
              '-c:a', 'aac', '-b:a', '192k');
} else if (audio) {
    args.push('-c:a', 'aac', '-b:a', '192k', '-map', '0:v:0', '-map', '1:a:0');
}
// BGM をループさせているので、動画の長さで打ち切る
args.push('-t', target.toFixed(2), out);

console.log(`[mux] ffmpeg: ${ffmpeg}`);
const r = spawnSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'], encoding: 'utf8' });
if (r.status !== 0) {
    console.error(r.stderr?.split('\n').slice(-15).join('\n'));
    process.exit(r.status || 1);
}
console.log(`[mux] 出力: ${out}`);

/**
 * --meta=<json> を渡すと、動画と同じ場所に投稿文（媒体別）をテキストで書き出す。
 * 動画とセットで残るので、投稿時にコピペするだけで済む。
 * JSON の書き方は video-scripts/meta/V2.json を参照。
 */
if (ARGS.meta) {
    const m = JSON.parse(readFileSync(ARGS.meta, 'utf8'));
    const L = [];
    const hr = (s) => L.push('', '='.repeat(60), s, '='.repeat(60));
    // **貼る文と、貼らない操作メモを混ぜない**。投稿画面へ持っていくのは「貼る」ブロックだけで、
    // ハッシュタグもクレジットもその中に入れておく（媒体を増やすたびに書き足す作業をなくす）。
    // クレジットは媒体ごとに独立した公開なので、どの媒体の本文にも入れる（VOICEVOX 利用規約）。
    const credit = m.credits?.length ? `音声: ${m.credits.join(' / ')}` : null;
    const block = (title, body, checklist) => {
        hr(`■ ${title}`);
        L.push('--- ここから貼る ---', ...body.filter(x => x !== null), '--- ここまで ---');
        if (checklist?.length) L.push('', '［操作メモ・貼らない］', ...checklist.map(c => `□ ${c}`));
    };
    L.push(`${m.title || ''}`, `動画: ${out}`);
    if (m.note) L.push(`メモ: ${m.note}`);

    if (m.youtube) {
        // タイトルは別欄なので分ける。説明欄はタグ・URL・クレジットまで込みで1枚に
        hr('■ YouTube Shorts');
        L.push('［タイトル欄に貼る］', m.youtube.title, '',
               '--- 説明欄にここから貼る ---', m.youtube.description, '',
               (m.youtube.hashtags || []).join(' '), ...(credit ? ['', credit] : []),
               '--- ここまで ---');
        if (m.youtube.checklist?.length) {
            L.push('', '［操作メモ・貼らない］', ...m.youtube.checklist.map(c => `□ ${c}`));
        }
    }
    if (m.tiktok) {
        block('TikTok', [m.tiktok.caption, '', (m.tiktok.hashtags || []).join(' '),
                         ...(credit ? ['', credit] : [])], m.tiktok.checklist);
    }
    if (m.instagram) {
        block('Instagram Reels', [m.instagram.caption, '', (m.instagram.hashtags || []).join(' '),
                                  ...(credit ? ['', credit] : [])], m.instagram.checklist);
    }
    if (m.x) {
        block('X', [m.x.text, ...(credit ? ['', credit] : [])], m.x.checklist);
    }
    const metaOut = out.replace(/\.mp4$/, '.txt');
    writeFileSync(metaOut, L.join('\n'), 'utf8');
    console.log(`[mux] 投稿文: ${metaOut}`);
}
