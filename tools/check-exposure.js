/**
 * 公開範囲を確かめる（2026-08-04 追加）。**定期的に実行する**（方針・ユーザー決定）。
 *
 *   node tools/check-exposure.js            … 追跡ファイルの検査だけ（オフライン）
 *   node tools/check-exposure.js --live     … 公開ドメインに実際に問い合わせる
 *
 * **なぜ要るか**: このリポジトリはユーザーサイト（`chem-assembler.github.io`）なので、
 * **追跡している全ファイルが chem.schoollenz.com から配信される**。
 * 2026-08-04 に実際に確認したところ、投稿計画・未公開の台本・アプリの不具合一覧・
 * 開発規約がすべて HTTP 200 で読めていた。**気づいたのは偶然**だったので機械で見る。
 *
 * 見るのは3つ:
 *  1. **配信されてはいけない種類のファイルが追跡されているか**（`_config.yml` の exclude で守れているか）
 *  2. **秘密らしき文字列**が追跡ファイルに混ざっていないか（鍵・トークン）
 *  3. `--live` のとき、**実際に公開ドメインから読めるか**
 *
 * **`_config.yml` の exclude は配信を止めるだけで、GitHub 上では見える。**
 * 本当に隠すならリポジトリの外へ出すか、リポジトリを非公開にすること。
 */
const { execSync } = require('child_process');
const fs = require('fs');

const live = process.argv.includes('--live');
const sh = c => execSync(c, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

/** 配信されると困る種類。`_config.yml` の exclude と対応させる */
const PRIVATE = [
    { re: /^video-scripts\//, why: '投稿計画・未公開の台本・告知文' },
    { re: /^past-exams\//, why: '過去問の書き起こし（置くと「公表」になり報告義務が生じる）' },
    { re: /^tools\//, why: '制作の道具' },
    { re: /^docs\//, why: '内部文書' },
    { re: /^\.claude\//, why: 'セッションの設定' },
    { re: /^[^/]+\.md$/, why: '設計書・開発方針（ルートの .md）' },
];

/** 秘密らしき形。**値そのものは出さない**（出したら本末転倒） */
const SECRETS = [
    { re: /\b(sk|pk)-[A-Za-z0-9]{20,}/, what: 'APIキーらしき文字列' },
    { re: /\bgh[pousr]_[A-Za-z0-9]{20,}/, what: 'GitHub トークン' },
    { re: /\bAKIA[0-9A-Z]{16}\b/, what: 'AWS アクセスキー' },
    { re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/, what: '秘密鍵' },
    { re: /["']?(password|passwd|secret|api[_-]?key|access[_-]?token)["']?\s*[:=]\s*["'][^"']{8,}["']/i, what: 'パスワード・鍵らしき代入' },
];

const problems = [], notes = [];

// ---- 1. 追跡ファイルの種類 ----
const tracked = sh('git ls-files').trim().split('\n').filter(Boolean);
const excluded = (() => {
    if (!fs.existsSync('_config.yml')) return null;
    const t = fs.readFileSync('_config.yml', 'utf8');
    const m = t.match(/exclude:\s*\n((?:\s*-\s*.*\n?)+)/);
    if (!m) return [];
    return m[1].split('\n').map(l => (l.match(/-\s*"?([^"#\s]+)"?/) || [])[1]).filter(Boolean);
})();

if (excluded === null) {
    problems.push('`_config.yml` がありません。**追跡ファイルが全部 公開ドメインから配信されます**');
} else {
    for (const p of PRIVATE) {
        const hit = tracked.filter(f => p.re.test(f));
        if (!hit.length) continue;
        const covered = excluded.some(x =>
            (x.endsWith('/') && hit[0].startsWith(x)) || x === '*.md' && /^[^/]+\.md$/.test(hit[0]) || hit[0] === x);
        if (!covered) problems.push(`${hit.length} 件が配信対象のままです（${p.why}）: 例 ${hit[0]}`);
    }
}

// ---- 2. 秘密らしき文字列 ----
const TEXT = /\.(js|mjs|json|md|html|css|yml|yaml|py|txt|sh)$/;
for (const f of tracked.filter(f => TEXT.test(f))) {
    let t;
    try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    for (const s of SECRETS) {
        if (s.re.test(t)) problems.push(`${f}: ${s.what} が含まれている可能性（中身は表示しません。目視で確認を）`);
    }
}

// ---- 3. 実際に読めるか ----
const report = () => {
    if (notes.length) console.log('\n⚠ 気づき:\n' + notes.map(s => '  - ' + s).join('\n'));
    if (problems.length) {
        console.log(`\n❌ ${problems.length} 件:\n` + problems.map(s => '  - ' + s).join('\n'));
        console.log('\n**`_config.yml` の exclude は配信を止めるだけで、GitHub 上では見えます。**' +
            '\n本当に隠すならリポジトリの外へ出すか、リポジトリを非公開にしてください。');
        process.exit(1);
    }
    console.log(`\n✅ 追跡 ${tracked.length} 件。配信されてはいけないものは exclude で守られています`);
    if (!live) console.log('（`--live` を付けると、公開ドメインから実際に読めるかも確かめます）');
};

if (!live) report();
else (async () => {
    const base = 'https://chem.schoollenz.com/';
    // 各分類の代表を1件ずつ叩く。**全部叩くと相手に迷惑**なので代表だけ
    // **push 済みのファイルから選ぶ。** 未 push のものを叩くと、
    // 配信されていないのではなく「まだ存在しない」だけで 404 が返り、
    // 検査が通ったように見えてしまう（2026-08-04 に実際に踏んだ）
    // **叩く先は固定にする。** 追跡ファイルから選ぶと、未 push のものを引いたときに
    // 「配信されていない」ではなく「まだ存在しない」で 404 が返り、**検査が通ったように見える**
    // （2026-08-04 に実際に踏んだ）。**長く存在している代表パスを名指しする。**
    const samples = [
        'video-scripts/QUEUE.md',      // 投稿計画。2026-08-04 に 200 で読めていた実績あり
        'video-scripts/LANES.md',      // 制作の内部手順。同上
        'CLAUDE.md',                   // 開発規約。同上
        'DEVELOPMENT.md',              // 開発方針
        'tools/videos.js',             // 制作の道具
    ];
    console.log(`\n[live] ${base} に問い合わせています…`);
    for (const f of samples) {
        try {
            const r = await fetch(base + f, { method: 'HEAD' });
            if (r.ok) problems.push(`**公開ドメインから読めます**（HTTP ${r.status}）: ${base}${f}`);
            else notes.push(`${f} → HTTP ${r.status}（読めません。正常）`);
        } catch (e) { notes.push(`${f}: 問い合わせ失敗（${e.message}）`); }
    }
    report();
})();
