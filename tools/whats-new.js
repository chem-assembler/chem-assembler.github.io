/**
 * 前回告知してからの変更を読み、**投稿の候補**を出す。
 *
 *   node tools/whats-new.js                  … 候補を並べる
 *   node tools/whats-new.js assembler        … アプリを絞る
 *   node tools/whats-new.js --since=<sha>    … 起点を手で指定する
 *   node tools/whats-new.js --mark           … 「ここまで告知した」を記録する
 *
 * **主役は教科の中身**（2026-08-03 ユーザー判断）。「v441 をリリースしました」ではなく
 * 「アミノ酸はこう描くのが標準です」と書き、更新であることは末尾に小さく添える。
 * **操作性の変化も同じ立て方**で拾う——「◯◯を直しました」ではなく
 * 「◯◯ができるようになりました」と、**学習者の側から**書く。
 *
 * **全自動にはしない。** 更新の大半は告知する価値がなく（内部の整理・テスト・道具）、
 * 機械に採否まで任せると必ず「誰も嬉しくない更新」を投稿する。
 * この道具は**候補を並べるところまで**で、選ぶのは人の仕事。
 *
 * 判定はコミットの型（feat/fix）と**触ったファイル**で行う。
 * ファイルの種類が「生徒が気づくか」のいちばん確かな手掛かりになる。
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const STATE = path.join('video-scripts', 'announced.json');

/** 配信しているアプリ（verify-release.js と同じ並び）。root はハブ */
const APPS = [
    { id: 'assembler', dir: 'assembler/', label: 'パズルでみる有機化学' },
    { id: 'ion-equation', dir: 'ion-equation/', label: 'イオンでみる化学反応式' },
    { id: 'ratio', dir: 'ratio/', label: '比例式でみる化学計算' },
    { id: 'qa', dir: 'qa/', label: '一問一答' },
];

/**
 * 触ったファイルから「何の話か」を決める。
 * **化学の中身** … 化学モデル・問題データ・名称ライブラリ・反応データ
 * **体験** … 画面・操作・クイズの出し方
 * **裏方** … 生徒には見えない（道具・台本・テスト・ドキュメント）
 */
const kindOf = (files) => {
    const visible = files.filter(f =>
        !/^tools\//.test(f) && !/^video-scripts\//.test(f) && !/^docs\//.test(f) &&
        !/\.md$/.test(f) && !/tests?\.js$/.test(f) && !/^\.claude\//.test(f) &&
        !/audit\.(html|js)$/.test(f) && !/test\.html$/.test(f) && !/demos.*\.json$/.test(f));
    if (!visible.length) return { kind: '裏方', files: [] };
    const chem = visible.filter(f =>
        /(chemistry|reactor|reaction)\.js$/.test(f) ||
        /(compounds|stages|reactions|model)\.json$/.test(f) ||
        /model\.js$/.test(f));
    return { kind: chem.length ? '化学の中身' : '体験', files: visible };
};

const args = process.argv.slice(2);
const only = args.find(a => !a.startsWith('-'));
const sinceArg = (args.find(a => a.startsWith('--since=')) || '').slice(8);
const doMark = args.includes('--mark');

const state = fs.existsSync(STATE) ? JSON.parse(fs.readFileSync(STATE, 'utf8')) : {};
const sh = (cmd) => execSync(cmd, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

const head = sh('git rev-parse HEAD').trim();
let found = 0;

for (const app of APPS) {
    if (only && app.id !== only) continue;
    if (!fs.existsSync(app.dir)) continue;

    const since = sinceArg || state[app.id]?.sha;
    const range = since ? `${since}..HEAD` : '-40';   // 起点が無ければ直近40件だけ見る
    let log;
    try {
        log = sh(`git log ${range} --no-merges --format=%x01%H%x02%s%x02%b -- ${app.dir}`);
    } catch (e) {
        console.error(`${app.id}: git log に失敗（起点 ${since} が見つからない？）`);
        continue;
    }

    const cands = [];
    for (const rec of log.split('\x01').slice(1)) {
        const [sha, subject, body] = rec.split('\x02');
        if (!sha) continue;
        // 型で粗く落とす。chore/docs/test/refactor は告知しない
        if (!/^(feat|fix)[(:]/.test(subject)) continue;
        // 収録・台帳まわりの直しは制作の都合なので落とす
        if (/^\w+\(sns\)/.test(subject)) continue;
        const files = sh(`git show --pretty= --name-only ${sha}`).trim().split('\n').filter(Boolean);
        const { kind, files: visible } = kindOf(files);
        if (kind === '裏方') continue;
        cands.push({ sha: sha.slice(0, 7), subject, body: (body || '').trim(), kind, visible });
    }

    if (!cands.length) continue;
    found += cands.length;

    console.log(`\n${'='.repeat(60)}\n■ ${app.label}（${app.id}）  候補 ${cands.length} 件` +
        `\n  起点: ${since ? since.slice(0, 7) : '（未記録なので直近40件）'}\n${'='.repeat(60)}`);

    for (const c of cands) {
        console.log(`\n[${c.kind}] ${c.sha}  ${c.subject}`);
        const why = c.body.split('\n').filter(l => l.trim() && !/^(Co-Authored-By|検証|🤖)/.test(l)).slice(0, 3);
        if (why.length) console.log(why.map(l => '    ' + l).join('\n'));
        console.log('    触った所: ' + c.visible.slice(0, 4).join(' / ') + (c.visible.length > 4 ? ' ほか' : ''));
        console.log(c.kind === '化学の中身'
            ? '    → 書き出し案:「◯◯はこう描く／こう決まる」と教科の話から入り、末尾に「アプリを更新しました」'
            : '    → 書き出し案:「◯◯ができるようになりました」と学習者の側から。操作の前後を並べた図が要る');
    }
}

if (!found) console.log('\n告知の候補はありません（前回の記録より後の変更が、生徒に見えない範囲だけでした）');
else console.log(`\n${'-'.repeat(60)}\n**採否は人が決める。基準は「生徒が触って気づくか」の1つだけ。**\n` +
    '出したら `node tools/whats-new.js --mark` で「ここまで告知した」を記録する。');

if (doMark) {
    for (const app of APPS) {
        if (only && app.id !== only) continue;
        if (!fs.existsSync(app.dir)) continue;
        state[app.id] = { sha: head, at: sh('git log -1 --format=%cI').trim() };
    }
    fs.writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
    console.log(`\n記録しました → ${STATE}（${head.slice(0, 7)} まで告知済み）`);
}
