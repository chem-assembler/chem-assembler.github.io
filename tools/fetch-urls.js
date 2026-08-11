/**
 * 投稿ずみ動画の URL を、機械で取れるところまで取る（2026-08-12）
 *
 * 使い方（リポジトリルートで）:
 *   node tools/fetch-urls.js              … 調べて表示するだけ（台帳は書き換えない）
 *   node tools/fetch-urls.js --write      … 空いている YouTube の URL を台帳に書き込む
 *   node tools/fetch-urls.js --verify     … 台帳にある URL が本当にその回のものか照合する
 *
 * **なぜ作ったか**: URL は手で貼る運用だったが、2026-08-12 に2件の貼り間違いが出た
 * （V61〜V63 の Instagram に V20・V21・V23 のもの／V70 の YouTube を V67 として渡された）。
 * **人が貼る限りこの事故は続く**ので、機械で取れるところは取り、
 * 取れないところは「検算だけでもする」形にした。
 *
 * 媒体ごとにできること（2026-08-12 に実地で確かめた）:
 *
 * | 媒体 | 一覧を取る | 貼った URL を照合する | 根拠 |
 * |---|---|---|---|
 * | YouTube | **できる** | **できる** | チャンネルRSS（`feeds/videos.xml`）＋ oEmbed。どちらも認証不要 |
 * | TikTok | できない | **できる** | oEmbed がキャプションを返す。一覧のRSSは無い |
 * | Instagram | できない | 順番だけ | oEmbed はトークンが要る（302）。ショートコードは base64＝**辞書順がほぼ投稿順** |
 * | X | できない | 順番だけ | API が有料。ステータスIDは Snowflake＝**数が大きいほど新しい** |
 *
 * ⚠ **チャンネルRSS は直近15件しか持たず、反映も遅れる**（Shorts は数時間〜1日）。
 * 「まだ出てこない＝投稿されていない」ではない。**空いたままなら後日もう一度走らせる**。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ARGS = process.argv.slice(2);
const doWrite = ARGS.includes('--write');
const doVerify = ARGS.includes('--verify');

const CHANNEL_ID = 'UCay_F29-lA0WHX0YLxj852g';   // @SchoolLenz（oEmbed の author_url から引いた）
const META_DIR = path.join('video-scripts', 'meta');

function get(url) {
    try {
        return execFileSync('curl', ['-s', '-m', '20', url], { encoding: 'utf8', maxBuffer: 1 << 24 });
    } catch {
        return '';
    }
}

const metas = fs.readdirSync(META_DIR).filter(f => f.endsWith('.json')).map(f => {
    const id = f.replace(/\.json$/, '');
    return { id, path: path.join(META_DIR, f), j: JSON.parse(fs.readFileSync(path.join(META_DIR, f), 'utf8')) };
});
const byId = Object.fromEntries(metas.map(m => [m.id, m]));

// ---------- ① YouTube: チャンネルRSS からタイトルで引き当てる ----------

const feed = get(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`);
const entries = [...feed.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(m => ({
    videoId: (m[1].match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1],
    title: (m[1].match(/<title>(.*?)<\/title>/) || [])[1],
    published: ((m[1].match(/<published>(.*?)<\/published>/) || [])[1] || '').slice(0, 10)
}));

// RSS のタイトルは実体参照が入る（&amp; など）ので戻してから比べる
const unesc = s => (s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

console.log(`=== YouTube チャンネルRSS（直近 ${entries.length} 件）===`);
if (!entries.length) console.log('  （取得できませんでした。ネットワークかチャンネルIDを確認してください）');

const filled = [];
const conflicts = [];
for (const e of entries) {
    const t = unesc(e.title);
    const hit = metas.find(m => m.j.youtube && m.j.youtube.title === t);
    const url = `https://youtube.com/shorts/${e.videoId}`;
    if (!hit) {
        console.log(`  ? ${e.published} ${e.videoId}  台帳に同じタイトルの回がありません: ${t}`);
        continue;
    }
    const cur = (hit.j.posted || {}).youtube;
    if (!cur) {
        filled.push({ m: hit, url, published: e.published, title: t });
        console.log(`  ＋ ${hit.id} ← ${url}（${e.published}）${doWrite ? '' : '  ※ --write で書き込みます'}`);
    } else if (!cur.includes(e.videoId)) {
        conflicts.push({ m: hit, cur, url, title: t });
        console.log(`  ⚠ ${hit.id} 台帳は ${cur} だが、同じタイトルの動画は ${url}`);
    } else {
        console.log(`  ✓ ${hit.id} ${e.videoId}`);
    }
}

if (doWrite && filled.length) {
    for (const f of filled) {
        f.m.j.posted = Object.assign({ date: f.published }, f.m.j.posted, { youtube: f.url });
        fs.writeFileSync(f.m.path, JSON.stringify(f.m.j, null, 2) + '\n');
    }
    console.log(`\n  → ${filled.length} 件を台帳に書き込みました（投稿文の焼き直しは mux --metaonly で）`);
}

// ---------- ② 貼ってある URL の照合 ----------

if (doVerify) {
    console.log('\n=== 台帳にある URL の照合 ===');
    for (const m of metas) {
        const p = m.j.posted || {};
        if (p.youtube) {
            const vid = (p.youtube.match(/(?:shorts\/|v=)([A-Za-z0-9_-]{11})/) || [])[1];
            const r = get(`https://www.youtube.com/oembed?url=https%3A//www.youtube.com/watch%3Fv%3D${vid}&format=json`);
            let title = null;
            try { title = JSON.parse(r).title; } catch { /* 403＝公開直後か限定公開 */ }
            if (title == null) console.log(`  … ${m.id} YouTube: 照合できず（公開直後だと 403 が返ります）`);
            else if (title === m.j.youtube.title) console.log(`  ✓ ${m.id} YouTube`);
            else console.log(`  ❌ ${m.id} YouTube が別の回を指しています → 「${title}」`);
        }
        if (p.tiktok) {
            const r = get(`https://www.tiktok.com/oembed?url=${p.tiktok}`);
            let title = null;
            try { title = JSON.parse(r).title; } catch { /* 取れないことがある */ }
            const want = (m.j.tiktok || {}).caption;
            if (title == null) console.log(`  … ${m.id} TikTok: 照合できず`);
            else if (want && title.startsWith(want.slice(0, 12))) console.log(`  ✓ ${m.id} TikTok`);
            else console.log(`  ❌ ${m.id} TikTok が別の回を指しています → 「${title.slice(0, 40)}」`);
        }
    }
}

// ---------- ③ 一覧が取れない媒体は「順番」で検算する ----------
//
// Instagram のショートコードは base64（A-Z a-z 0-9 - _）なので辞書順がほぼ投稿順。
// X のステータスIDは Snowflake なので数が大きいほど新しい。
// **投稿日の順に並べたとき、この2つが逆行していたら貼り間違い**。

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const igRank = code => [...code].reduce((a, c) => a * 64n + BigInt(Math.max(0, B64.indexOf(c))), 0n);

console.log('\n=== 一覧が取れない媒体の検算（並び順）===');
const posted = metas
    .filter(m => (m.j.posted || {}).date)
    .sort((a, b) => a.j.posted.date.localeCompare(b.j.posted.date) || a.id.localeCompare(b.id, 'en', { numeric: true }));

for (const [key, label, rank] of [
    ['instagram', 'Instagram', u => igRank((u.match(/\/reel\/([A-Za-z0-9_-]+)/) || [, ''])[1])],
    ['x', 'X', u => BigInt((u.match(/status\/(\d+)/) || [, '0'])[1])]
]) {
    const list = posted.filter(m => (m.j.posted || {})[key]).map(m => ({ id: m.id, date: m.j.posted.date, r: rank(m.j.posted[key]) }));
    let bad = 0;
    for (let i = 1; i < list.length; i++) {
        // **同じ日どうしは比べない。** 台帳が持つのは日付までで、その日の中の順番は分からない
        // （実際 8/01 は V14 → V9 の順に出しており、ID の順ではなかった）。
        // 日をまたいだ逆行だけが「別の日の URL を貼った」証拠になる。
        if (list[i].date === list[i - 1].date) continue;
        if (list[i].r <= list[i - 1].r) {
            console.log(`  ❌ ${label}: ${list[i - 1].id}(${list[i - 1].date}) より ${list[i].id}(${list[i].date}) のほうが古い URL です`);
            bad++;
        }
    }
    console.log(`  ${bad ? '' : '✓ '}${label}: ${list.length} 件を照合${bad ? `／逆行 ${bad} 件` : '／逆行なし'}`);
}

console.log('\n※ TikTok・Instagram・X は一覧を機械で取れません（RSS が無い／API が有料・要トークン）。');
console.log('※ YouTube の RSS は直近15件だけで反映も遅れます。空いたままなら後日もう一度走らせてください。');
