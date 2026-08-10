/**
 * SNS動画の在庫台帳を出す・不整合を検出する（2026-08-01）
 *
 * 使い方（リポジトリルートで）:
 *   node tools/videos.js          在庫表と投稿キューを出し、不整合があれば非ゼロで終了
 *   node tools/videos.js --urls   投稿済みの回のURLも一覧する
 *
 * **データを二重に持たないための道具**。在庫の実体は次の2か所にしかない:
 *   - video-scripts/meta/<ID>.json … 1本ぶんのデータ。**作ったレーンが持つ**。
 *     投稿したら `posted`（日付＋媒体別URL）をここに書き足す
 *   - video-scripts/QUEUE.md      … 出す順だけ。**main（管理役）が持つ**。レーンは触らない
 * 表はここから毎回組み立てる＝台帳を手で二重管理しない。
 *
 * いちばん効く検査は「**meta にあるのに QUEUE.md に無い**」。
 * レーンが新作を作ると自動でここに現れるので、管理役が取りこぼさない。
 */
const fs = require('fs');
const path = require('path');

const META_DIR = path.join('video-scripts', 'meta');
const QUEUE = path.join('video-scripts', 'QUEUE.md');
const OUT_DIR = path.join('video-scripts', 'out');
// クイズシリーズは2026-08-09 に足した5本目の列。アプリのクイズ画面をそのまま回す型で、
// **出題範囲を変えるだけで量産できる**のが他の4列と違うところ（他は1本ずつ題材を作る）。
// 化合物作ってみたは2026-08-11 に足した6本目。自由モードで有名化合物をゼロから描く型で、
// **未収録の化合物をライブラリに足しながら進む**（V68 のカフェインが最初）
const SERIES = ['異性体シリーズ', '官能基シリーズ', '反応シリーズ', '立体シリーズ', 'クイズシリーズ',
                '化合物作ってみた'];
const MEDIA = ['youtube', 'tiktok', 'instagram', 'x'];

/**
 * X の重み付き文字数を数える（上限280）。
 * X は**日本語・全角を1文字あたり2**として数え、**URL は実際の長さに関係なく23**として数える。
 * つまり見た目の文字数では投稿できるかどうか判断できない。
 */
const X_WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꀀ-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/;
const xWeight = (text) => {
    const masked = text.replace(/https?:\/\/\S+/g, ''.repeat(23));
    let n = 0;
    for (const c of masked) {
        if (c === '') n += 1;                       // URL 1文字ぶんの置き換え
        else if (X_WIDE.test(c)) n += 2;                  // 日本語・全角
        else if (c.codePointAt(0) > 0x1F000) n += 2;      // 絵文字
        else n += 1;
    }
    return n;
};

const showUrls = process.argv.includes('--urls');
const doRefresh = process.argv.includes('--refresh');
const checkUrls = process.argv.includes('--check-urls');
const problems = [];
const notes = [];

// ---- meta を読む ----
const metas = new Map();
for (const f of fs.readdirSync(META_DIR).filter(f => f.endsWith('.json'))) {
    const id = path.basename(f, '.json');
    try {
        metas.set(id, JSON.parse(fs.readFileSync(path.join(META_DIR, f), 'utf8')));
    } catch (e) {
        problems.push(`${META_DIR}/${f}: JSON として読めません（${e.message}）`);
    }
}

// ID は V+数字。数字順に並べる（V2 が V11 より前に来るように）
const num = id => parseInt(String(id).replace(/^V/, ''), 10) || 0;
const ids = [...metas.keys()].sort((a, b) => num(a) - num(b));

// ---- QUEUE.md から出す順を読む ----
// 「1. V4 …」のような行の先頭にある ID を順番に拾うだけ（書式に縛られない）
let queue = [];
const needsRerecord = new Set();
const held = new Set();   // 次回予告の相手待ちなどで、完成しているが出さない回
const dropped = new Set(); // 企画として取り下げた回。完成していても投稿しない（在庫に数えない）
if (fs.existsSync(QUEUE)) {
    const text = fs.readFileSync(QUEUE, 'utf8');
    // **「1. V4 — …」の形だけを出す順として拾う**（番号つき＋全角ダッシュ必須）。
    // `-` の箇条書きまで拾っていたため、本文中の「- V21 の…」を順番の1件と誤読していた
    // （2026-08-01。同じ回が2回並んで見えた）
    for (const m of text.matchAll(/^\s*\d+\.\s*(V\d+)\s+—(.*)$/gm)) {
        queue.push(m[1]);
        // 「要再収録」は**出せるかどうか**の話なので、レーンの持ち物である meta ではなく
        // 管理役の QUEUE.md 側に書く（main から meta を触るとレーンの作業とぶつかる）
        if (/要再収録/.test(m[2])) needsRerecord.add(m[1]);
    }
    // 保留リストは表で書く（理由と待っている相手を並べたいため）。表の行頭の ID も
    // **管理下にある**とみなす＝「QUEUE に無い」で誤検出しない
    for (const m of text.matchAll(/^\s*\|\s*(V\d+)\b/gm)) held.add(m[1]);
    // 「没にした回」の節にある表は**企画として取り下げた回**（2026-08-08・V33 が最初）。
    // 完成していても投稿しないので、在庫にも保留にも数えない。
    // 保留（＝相手が完成すれば出す）と混ぜると、「あと何本出せるか」が読めなくなる
    const after = text.split(/^#{2,3}\s*没にした回\s*$/m)[1];
    if (after) {
        const section = after.split(/^#{2,3}\s/m)[0];
        for (const m of section.matchAll(/^\s*\|\s*(V\d+)\b/gm)) {
            dropped.add(m[1]);
            held.delete(m[1]);
        }
    }
} else {
    problems.push(`${QUEUE} がありません（出す順を持つファイル）`);
}

// ---- 検査 ----
const seenCampaign = new Map();
for (const id of ids) {
    const m = metas.get(id);
    const where = `meta/${id}.json`;
    if (!m.title) problems.push(`${where}: title がありません`);
    if (m.campaign) {
        if (m.campaign !== id.toLowerCase()) {
            problems.push(`${where}: campaign が "${m.campaign}"（"${id.toLowerCase()}" を期待。UTM が別の回と混ざります）`);
        }
        if (seenCampaign.has(m.campaign)) {
            problems.push(`${where}: campaign "${m.campaign}" が ${seenCampaign.get(m.campaign)} と重複（流入が合算されて見分けられません）`);
        }
        seenCampaign.set(m.campaign, id);
    }
    // X の文字数（2026-08-01 追加）。**日本語は1文字が2つぶんとして数えられる**ので、
    // 見た目の文字数では判断できない。URL は長さに関係なく23として数えられる。
    // 実績: 重み 286 の V2 は投稿できた／304 の V14 は入りきらなかった。**260 以下を目安**にする。
    // 「前回はこちら」の1行は**別投稿（返信）**なので、この数には含めない
    if (m.x && m.x.text) {
        const credit = (m.credits || []).length ? `\n\n音声: ${(m.credits || []).join(' / ')}` : '';
        const n = xWeight(m.x.text + credit);
        if (n > 280) problems.push(`${where}: X の本文が重み ${n}（上限280を超えるので投稿できません）`);
        else if (n > 260) notes.push(`${id}: X の本文が重み ${n}（上限280に近い。260以下に詰めると安全）`);
    }
    if (m.series && !SERIES.includes(m.series)) {
        problems.push(`${where}: series "${m.series}" は既知のシリーズにありません（表記ゆれ？）`);
    }
    if (m.posted) {
        const urls = MEDIA.filter(k => m.posted[k]);
        // ここは「不整合」ではなく「記入がまだ」。赤字にすると常時赤のままになるので ⚠ に留める
        if (!m.posted.date) notes.push(`${id}: 投稿日が未記入`);
        if (!urls.length) notes.push(`${id}: 投稿済みだが URL が1つも入っていない（次の回を前作にぶら下げるときに手が止まります）`);
        else if (urls.length < MEDIA.length) notes.push(`${id}: URL が ${urls.length}/${MEDIA.length} 媒体ぶん（未取得: ${MEDIA.filter(k => !m.posted[k]).join('・')}）`);
    }
    // **投稿済みの回は出す順に載っていなくてよい**（QUEUE から投稿済みリストを廃止したため。
    // 投稿済みかどうかは meta の `posted` が唯一の情報源＝手書きの一覧と食い違わない）
    if (!queue.includes(id) && !held.has(id) && !dropped.has(id) && !m.posted) {
        problems.push(`${QUEUE} に ${id} がありません（管理から漏れています。出す順に入れてください）`);
    }
}
// **同じURLが2つの回に入っていないか**（2026-08-03 追加）。
// V30 の X に V13 の URL を貼ってしまった実例がある。前作へぶら下げる導線が
// 自分自身を指すことになり、しかも見た目では気づけない
{
    const byUrl = new Map();
    for (const [id, m] of metas) {
        if (!m.posted) continue;
        for (const k of MEDIA) {
            const u = m.posted[k];
            if (!u) continue;
            if (!byUrl.has(u)) byUrl.set(u, []);
            byUrl.get(u).push(`${id} の ${k}`);
        }
    }
    for (const [url, where] of byUrl) {
        if (where.length > 1) {
            problems.push(`同じURLが ${where.join(' と ')} に入っています（貼り間違い）: ${url}`);
        }
    }
}
for (const id of queue) {
    if (!metas.has(id)) problems.push(`${QUEUE} の ${id} に対応する meta がありません`);
    // **投稿済みなのに出す順に残っている**のを拾う（2026-08-01 追加）。
    // QUEUE を手で直し忘れると、出した回をもう一度出しそうになる
    else if (metas.get(id).posted) notes.push(`${id}: 投稿済みだが ${QUEUE} の出す順に残っている（消してよい）`);
}

// ---- 在庫表 ----
/**
 * 出力ファイル名はタイトルそのもの（`V30 ケトンとアルデヒド、どこが違う？.mp4`）。
 * **命名の規則は tools/record/mux.mjs が持っていて、ここはそれに合わせるだけ**（2026-08-03）。
 * 旧名（`V30-final.mp4`）も見るので、まだ作り直していない回も「完成」と読める。
 */
const safeName = s => s.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
const mp4Path = id => {
    const t = metas.get(id)?.title;
    const byTitle = t && path.join(OUT_DIR, safeName(t) + '.mp4');
    if (byTitle && fs.existsSync(byTitle)) return byTitle;
    const legacy = path.join(OUT_DIR, `${id}-final.mp4`);
    return fs.existsSync(legacy) ? legacy : null;
};
const hasMp4 = id => mp4Path(id) !== null;

/**
 * **収録した版が古い回を挙げる**（2026-08-04 追加）。
 *
 * アプリが v365 → v500 と動いたのに、在庫の大半がそれ以前の収録だったことに
 * 気づけなかった。入口のレイアウトが変わっても在庫は「完成」のままで、
 * **投稿の直前に1本ずつ目で見て初めて分かる**状態だった。
 * `meta.recorded.appVersion`（mux が record.mjs の recinfo から写す）を
 * 現在の版と比べる。**古いこと自体は不具合ではない**（画面が変わっていなければ問題ない）ので、
 * 問題ではなく気づきとして出す。
 */
{
    const cur = (() => {
        try {
            const html = fs.readFileSync(path.join('assembler', 'index.html'), 'utf8');
            return +((html.match(/class="version">v(\d+)/) || [])[1] || 0);
        } catch { return 0; }
    })();
    if (cur) {
        const stale = [];
        for (const [id, m] of metas) {
            if (m.posted || held.has(id) || needsRerecord.has(id)) continue;
            if (!hasMp4(id)) continue;
            const v = +String(m.recorded?.appVersion || '').replace(/^v/, '') || 0;
            if (!v) stale.push(`${id}: 収録した版が記録されていない（撮り直すと記録されます）`);
            else if (cur - v >= 20) stale.push(`${id}: v${v} で収録（現在 v${cur}・${cur - v} 版ぶん古い）`);
        }
        if (stale.length) {
            notes.push(`**収録した版が古い回が ${stale.length} 件**（画面が変わっていれば撮り直しが要ります）`);
            stale.forEach(s => notes.push('  ' + s));
        }
    }
}

const state = id => {
    const m = metas.get(id);
    if (m.posted) return '投稿済';
    if (dropped.has(id)) return '没';   // 企画として取り下げた。完成していても出さない
    if (needsRerecord.has(id)) return '要再収録';
    if (held.has(id)) return '保留';
    return hasMp4(id) ? '完成' : '未収録';
};

// 全角（東アジアの広い文字）は2桁ぶんの幅を取る。半角基準で padEnd すると表が崩れる
const dw = s => [...String(s)].reduce((n, c) => n + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/.test(c) ? 2 : 1), 0);
const pad = (s, w) => String(s) + ' '.repeat(Math.max(0, w - dw(s)));

const rows = ids.map(id => {
    const m = metas.get(id);
    return [id, state(id), (m.series || '—').replace('シリーズ', ''), m.title.replace(/^V\d+\s*/, '')];
});
const w = [0, 1, 2].map(i => Math.max(...rows.map(r => dw(r[i])), 4));
console.log('=== 在庫 ===');
for (const r of rows) {
    console.log(`${pad(r[0], w[0])}  ${pad(r[1], w[1])}  ${pad(r[2], w[2])}  ${r[3]}`);
}
const count = s => ids.filter(id => state(id) === s).length;
console.log(`\n投稿済 ${count('投稿済')} / 完成・未投稿 ${count('完成')} / 保留 ${count('保留')} / 要再収録 ${count('要再収録')} / 未収録 ${count('未収録')}`
    + (count('没') ? ` / 没 ${count('没')}` : ''));
// 保留は「出せるのに出さない」状態。理由は QUEUE.md にあるので、そこへ誘導する
if (count('保留')) console.log(`（保留の理由と待っている相手は ${QUEUE} の「保留」節）`);
// 没は「もう出さない」ので在庫でも保留でもない。混ぜると「あと何本出せるか」が読めなくなる
if (count('没')) console.log(`（没にした理由は ${QUEUE} の「没にした回」節）`);

// ---- 次に出すもの ----
const next = queue.filter(id => metas.has(id) && state(id) === '完成');
console.log(`\n=== 次に出す順（QUEUE.md） ===\n${next.length ? next.join(' → ') : '（出せる在庫がありません）'}`);

if (showUrls) {
    console.log('\n=== 投稿済みのURL ===');
    for (const id of ids.filter(id => metas.get(id).posted)) {
        const p = metas.get(id).posted;
        console.log(`${id}（${p.date || '日付未記入'}）`);
        for (const k of MEDIA) console.log(`  ${k.padEnd(9)} ${p[k] || '—'}`);
    }
}

/**
 * `--refresh`: 完成している回の**投稿文（.txt）を meta から作り直す**（2026-08-01）。
 *
 * **URLを1本記録すると、それを前作にもつ回の投稿文が古くなる**。
 * 例: V16 の X の URL を入れた時点で、V17 の「前回はこちら」に貼る文が確定する。
 * 手で作り直すと必ず忘れるので、**URLを記録したら毎回これを走らせる**。
 * 動画は再エンコードしない（mux の `--metaonly`）ので数秒で終わる。
 */
if (doRefresh) {
    const { spawnSync } = require('child_process');
    const mux = path.join('tools', 'record', 'mux.mjs');
    let ok = 0, skip = 0, ng = 0;
    for (const id of ids) {
        const mp4 = mp4Path(id);
        if (!mp4) { skip++; continue; }   // まだ収録していない回
        const r = spawnSync(process.execPath,
            [mux, `--video=${mp4}`, `--meta=${path.join(META_DIR, `${id}.json`)}`, '--metaonly', `--out=${mp4}`],
            { encoding: 'utf8' });
        if (r.status === 0) ok++;
        else { ng++; console.log(`  ${id}: 投稿文の書き直しに失敗 ${(r.stderr || '').split('\n')[0]}`); }
    }
    console.log(`\n[refresh] 投稿文を書き直した ${ok} 件 / 未収録で飛ばした ${skip} 件${ng ? ` / 失敗 ${ng} 件` : ''}`);
}

/**
 * `--check-urls`: **記録した YouTube の URL が本当にその回か**を YouTube に聞いて確かめる
 * （2026-08-03 追加）。oEmbed はログイン不要で、タイトルとチャンネル名が返る。
 *
 * 重複検査は「同じURLを2度貼った」しか拾えない。**別の回の、重複しないURLを貼った**
 * ときは形の上では正しく見えるので、外から答え合わせするしかない。
 * ネットワークを使うので既定では走らせない。
 */
const finish = () => {
    if (notes.length) console.log('\n⚠ 気づき:\n' + notes.map(s => '  - ' + s).join('\n'));
    if (problems.length) {
        console.log(`\n❌ ${problems.length} 件の問題:\n` + problems.map(s => '  - ' + s).join('\n'));
        process.exit(1);
    }
    console.log('\n✅ 不整合はありません');
};

if (!checkUrls) finish();
else (async () => {
    console.log('\n[check-urls] YouTube に問い合わせて突き合わせています…');
    for (const [id, m] of metas) {
        const u = m.posted?.youtube;
        if (!u) continue;
        try {
            const r = await fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(u));
            if (!r.ok) { problems.push(`${id}: YouTube の URL が引けません（HTTP ${r.status}）: ${u}`); continue; }
            const j = await r.json();
            // 台本のタイトルと YouTube のタイトルは別物なので、meta の youtube.title と突き合わせる
            const want = m.youtube?.title;
            if (want && j.title !== want) {
                problems.push(`${id}: YouTube 側のタイトルが meta と違います\n      YouTube: ${j.title}\n      meta   : ${want}`);
            }
            if (j.author_name && j.author_name !== 'SchoolLenz') {
                problems.push(`${id}: チャンネルが SchoolLenz ではありません（${j.author_name}）: ${u}`);
            }
        } catch (e) {
            notes.push(`${id}: YouTube への問い合わせに失敗（${e.message}）。ネットワークの問題かもしれません`);
        }
    }
    finish();
})();
