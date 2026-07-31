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
const SERIES = ['異性体シリーズ', '官能基シリーズ', '反応シリーズ', '立体シリーズ'];
const MEDIA = ['youtube', 'tiktok', 'instagram', 'x'];

const showUrls = process.argv.includes('--urls');
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
if (fs.existsSync(QUEUE)) {
    const text = fs.readFileSync(QUEUE, 'utf8');
    for (const m of text.matchAll(/^\s*(?:\d+\.|-)\s*(V\d+)\b(.*)$/gm)) {
        queue.push(m[1]);
        // 「要再収録」は**出せるかどうか**の話なので、レーンの持ち物である meta ではなく
        // 管理役の QUEUE.md 側に書く（main から meta を触るとレーンの作業とぶつかる）
        if (/要再収録/.test(m[2])) needsRerecord.add(m[1]);
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
    if (m.series && !SERIES.includes(m.series)) {
        problems.push(`${where}: series "${m.series}" は既知の4シリーズにありません（表記ゆれ？）`);
    }
    if (m.posted) {
        const urls = MEDIA.filter(k => m.posted[k]);
        // ここは「不整合」ではなく「記入がまだ」。赤字にすると常時赤のままになるので ⚠ に留める
        if (!m.posted.date) notes.push(`${id}: 投稿日が未記入`);
        if (!urls.length) notes.push(`${id}: 投稿済みだが URL が1つも入っていない（次の回を前作にぶら下げるときに手が止まります）`);
        else if (urls.length < MEDIA.length) notes.push(`${id}: URL が ${urls.length}/${MEDIA.length} 媒体ぶん（未取得: ${MEDIA.filter(k => !m.posted[k]).join('・')}）`);
    }
    if (!queue.includes(id)) {
        problems.push(`${QUEUE} に ${id} がありません（管理から漏れています。出す順に入れてください）`);
    }
}
for (const id of queue) {
    if (!metas.has(id)) problems.push(`${QUEUE} の ${id} に対応する meta がありません`);
}

// ---- 在庫表 ----
const hasMp4 = id => fs.existsSync(path.join(OUT_DIR, `${id}-final.mp4`));
const state = id => {
    const m = metas.get(id);
    if (m.posted) return '投稿済';
    if (needsRerecord.has(id)) return '要再収録';
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
console.log(`\n投稿済 ${count('投稿済')} / 完成・未投稿 ${count('完成')} / 要再収録 ${count('要再収録')} / 未収録 ${count('未収録')}`);

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

if (notes.length) console.log('\n⚠ 気づき:\n' + notes.map(s => '  - ' + s).join('\n'));
if (problems.length) {
    console.log(`\n❌ ${problems.length} 件の問題:\n` + problems.map(s => '  - ' + s).join('\n'));
    process.exit(1);
}
console.log('\n✅ 不整合はありません');
