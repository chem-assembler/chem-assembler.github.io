/**
 * compounds.json / stages.json の機械検証（Node で実行。ブラウザ不要）
 *
 *   node tools/verify-compounds.js
 *
 * 化合物データを追加・修正したときに、投入前・コミット前に必ず通すためのツール。
 * chemistry.js を読み込んで実アプリと同じ判定を使うので、ここを通れば
 * 「価標が壊れている」「既存と区別できない」「図が重なっている」事故は防げる。
 *
 * 検査項目:
 *   0. **ファイルの並べ方**（compounds.json が1行1件のままか。下の「なぜ要るか」を読むこと）
 *   1. 価標が妥当か（isValencyValid。ニトロ基の N=4 の特例も実アプリと同じ扱い）
 *   2. 重原子どうし・自動水素込みで近すぎる原子が無いか（監査ページと同じ閾値の考え方）
 *   3. 命名の一意性: 「正準コード＋立体コード」が他エントリと衝突していないか（テスト F8 と同じ性質）
 *   4. 立体記述子が読めるか（stereo を持つエントリ／haworthFace を持つエントリ）
 *
 * 終了コード 0 = 合格、1 = 問題あり（内容は標準出力に出す）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// アプリ本体は assembler/ 配下（2026-07-26 の構成変更でルートはハブページになった）
const ROOT = path.resolve(__dirname, '..', 'assembler');
const ctx = vm.createContext({ window: {}, performance: { now: () => 0 } });
vm.runInContext(fs.readFileSync(path.join(ROOT, 'chemistry.js'), 'utf8'), ctx);
const W = ctx.window;

const HEAVY_MIN = 24;  // 重原子どうしの最小距離（px）。これ未満は作図が窮屈
const HYDROGEN_MIN = 11;   // 自動水素を含めた最小距離（px）。これ未満は不合格
const HYDROGEN_WARN = 12;  // 警告どまり（既存データに 11.5px のものがあり、見た目は許容範囲）
/**
 * 自動水素が「自分の親を端点に持たない結合線」の下に来る距離（px）。
 *
 * ⚠ **上の HYDROGEN_MIN とは別の量**。あちらは「原子と H の距離」で、こちらは
 * 「H が結合線の下」―― 混ぜてはいけない（DESIGN_hit_areas.md §10-7）。
 * 値はアプリ本体の `HYDROGEN_BOND_CLEARANCE`（game.js）と同じ 12。
 * **写し**なのは、ここが chemistry.js しか読まない（game.js は DOM 前提で vm に載らない）ため。
 * 実測: 登録図 939件（比較できる結合を持つ 926件）の最小は 14.32px
 * （スクロース・β-D-フルクトフラノース）で、14px 未満は 0件。
 */
const HYDROGEN_LINE_MIN = 12;

function loadJson(name) {
    return JSON.parse(fs.readFileSync(path.join(ROOT, name), 'utf8'));
}

function buildMolecule(target) {
    const m = new W.Molecule();
    const ids = target.atoms.map(a => {
        const atom = m.addAtom(a.element, a.x, a.y);
        if (a.haworthFace === 1 || a.haworthFace === -1) atom.haworthFace = a.haworthFace;
        return atom.id;
    });
    target.bonds.forEach(b => m.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
    return { mol: m, ids };
}

// データの立体記述子（添字キー）を実行時IDへ写像する（game.js の _mapStereoToMol と同じ）。
// 指定の無い側はキーごと作らない（アプリと同じ形で canonicalStereoCode に渡すため）
function mapStereo(stereo, mol, ids) {
    const out = {};
    if (stereo.bondGeo) {
        out.bondGeo = {};
        Object.keys(stereo.bondGeo).forEach(k => {
            const [i, j] = k.split('_').map(Number);
            const id1 = ids[i], id2 = ids[j];
            if (id1 == null || id2 == null) return;
            const bond = mol.getBond(id1, id2);
            if (!bond) return;
            out.bondGeo[`${bond.atomId1}_${bond.atomId2}`] = stereo.bondGeo[k];
        });
    }
    if (stereo.atomParity) {
        out.atomParity = {};
        Object.keys(stereo.atomParity).forEach(k => {
            const id = ids[Number(k)];
            if (id != null) out.atomParity[id] = stereo.atomParity[k];
        });
    }
    return out;
}

/**
 * ライブラリ側の立体コードを組み立てる。**game.js の getCompoundLibrary と同じ材料で作る**。
 *
 * 材料は「データの stereo 記述子」＋「haworthFace から読む環の立体」の2つだけで、
 * **座標からのフィッシャー読み取り（readAtomParityFromFischer）は混ぜない**。
 * 混ぜると、立体を指定していない総称エントリ（アラニン・乳酸）がたまたま十字に
 * 描かれているだけで立体コードを持ってしまい、D-体と区別できなくなる。
 * アプリはユーザーが描いた図にだけ isFischerOriented の門番を掛けて読み、
 * ライブラリ側は指定された立体しか持たない（v446）。ここもそれに合わせる。
 */
function stereoCodeOf(entry) {
    const { mol, ids } = buildMolecule(entry.target);
    const mapped = entry.stereo ? mapStereo(entry.stereo, mol, ids) : {};
    const ringParity = W.readRingParityFromHaworth(mol);
    let stereoCode = null;
    if (entry.stereo || Object.keys(ringParity).length > 0) {
        stereoCode = W.canonicalStereoCode(mol, {
            atomParity: { ...(mapped.atomParity || {}), ...ringParity },
            bondGeo: mapped.bondGeo
        });
    }
    return {
        mol,
        code: W.canonicalCode(mol),
        stereoCode,
        ringReadable: Object.keys(ringParity).length
    };
}

function minDistances(mol) {
    const heavy = mol.atoms;
    let minHeavy = Infinity;
    for (let i = 0; i < heavy.length; i++) {
        for (let j = i + 1; j < heavy.length; j++) {
            minHeavy = Math.min(minHeavy, Math.hypot(heavy[i].x - heavy[j].x, heavy[i].y - heavy[j].y));
        }
    }
    const points = [...heavy, ...mol.calculateHydrogens()];
    let minAll = Infinity;
    for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const d = Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y);
            if (d > 0.5) minAll = Math.min(minAll, d);
        }
    }
    return { minHeavy, minAll };
}

/**
 * 「自動水素 ↔ その H の親を端点に持たない結合線」の最短距離と、その相手。
 * 端点のすぐそば（t が 0.02 未満／0.98 超）を見ないのは game.js の `underBondLine` と同じ
 * ―― そこは「原子と H の距離」（HYDROGEN_MIN）の領分だから。
 */
function minHydrogenBondGap(mol) {
    const hs = mol.calculateHydrogens();
    const byId = new Map(mol.atoms.map(a => [a.id, a]));
    let worst = Infinity, detail = '';
    mol.bonds.forEach(b => {
        const p = byId.get(b.atomId1), q = byId.get(b.atomId2);
        if (!p || !q) return;
        const vx = q.x - p.x, vy = q.y - p.y;
        const L2 = vx * vx + vy * vy;
        if (!L2) return;
        hs.forEach(h => {
            if (h.parentId === p.id || h.parentId === q.id) return;
            const t = ((h.x - p.x) * vx + (h.y - p.y) * vy) / L2;
            if (t <= 0.02 || t >= 0.98) return;
            const d = Math.hypot(h.x - (p.x + t * vx), h.y - (p.y + t * vy));
            if (d < worst) {
                worst = d;
                detail = `H(${h.x.toFixed(0)},${h.y.toFixed(0)}) ↔ ` +
                    `${p.element}(${p.x.toFixed(0)},${p.y.toFixed(0)})-${q.element}(${q.x.toFixed(0)},${q.y.toFixed(0)})`;
            }
        });
    });
    return { gap: worst, detail };
}

const problems = [];
const warnings = [];

/* ================================================================== *
 * 検査 0. ファイルの並べ方（データの中身ではなく「差分の読めなさ」を守る）
 *
 * **なぜ機械で見るか。** `compounds.json` は「末尾追記のみ・整形し直さない」が
 * 規約（CLAUDE.md「重要ルール」・DEVELOPMENT.md §7-1）だが、**人の記憶に頼らせると3回破られた**:
 *   - v1046 `6718351` … アドレナリンの N-メチル基を1つ直しただけで 11516/11516 の全書き換え
 *   - `5c2bfe3` "AI auto-save" … 209/10814
 *   - v1059 `84409cb` … SNS 動画のコミットの副作用で 84890/917。
 *     **4件の追加を見るのに 84,890 行の差分**を読むことになり、人のレビューが成立しなくなった
 * 破り方はいつも同じで「`JSON.parse` → `JSON.stringify` で書き戻す」。
 * 中身は無傷なので既存の検査は全部通ってしまう ＝ **ここで見るしかない**。
 *
 * 兄弟ファイルを1行1件にしない理由は下の LAYOUT の注記に書いた。
 * ================================================================== */
function checkLayout() {
    // --- compounds.json: 1行1件 ---
    const raw = fs.readFileSync(path.join(ROOT, 'compounds.json'), 'utf8');
    const arr = JSON.parse(raw);
    const where = 'compounds.json';
    const HOWTO = '（規約: 外側の [ ] と、1件＝1行。整形し直さず末尾に追記する）';

    if (raw.charCodeAt(0) === 0xFEFF) problems.push(`${where}: BOM が付いています（UTF-8 BOM なしが規約）`);
    const crlf = (raw.match(/\r\n/g) || []).length;
    const lf = (raw.match(/\n/g) || []).length;
    if (crlf !== lf) problems.push(`${where}: 改行が CRLF で揃っていません（CRLF ${crlf} / LF ${lf}）`);

    const lines = raw.replace(/\r\n$/, '').split('\r\n');
    if (lines.length !== arr.length + 2) {
        problems.push(`${where}: 1行1件になっていません` +
            `（${arr.length} 件なのに ${lines.length} 行＝1件あたり ${(lines.length / arr.length).toFixed(1)} 行。` +
            `期待は ${arr.length + 2} 行）${HOWTO}`);
        return; // 行と件の対応が付かないので以降は見ない
    }
    if (lines[0] !== '[') problems.push(`${where}: 1行目が "[" 単独ではありません${HOWTO}`);
    if (lines[lines.length - 1] !== ']') problems.push(`${where}: 最終行が "]" 単独ではありません${HOWTO}`);
    for (let i = 0; i < arr.length; i++) {
        const L = lines[i + 1];
        const tail = i === arr.length - 1 ? '}' : '},';
        if (!L.startsWith('{') || !L.endsWith(tail)) {
            problems.push(`${where}: ${i + 2} 行目（${arr[i].id || arr[i].name}）が ` +
                `"{" で始まり "${tail}" で終わる1件になっていません${HOWTO}`);
            break; // 1件出れば十分（全部並べても読めない）
        }
    }

    /* --- 兄弟ファイル: 1行1件にはしない。理由つきで別の見張りを置く ---
     *
     * `stages.json`（117件）… 中身は **`JSON.stringify(x, null, 2)` そのもの**なので、
     *   書き戻しても差分が出ない（＝この事故が起こりえない不動点）。実績も
     *   「id 振り = +117行・0削除」「分子式の修正 = 1/1」と、変更の大きさに比例している。
     * `reactions.json`（14件）… 1件が機構アニメの全ステップで約190行ある。
     *   1行にすると1件が 10KB 超の1行になり、**巻矢印を1手ずつ読む**という
     *   レビューのやり方そのものが潰れる。追加はいつも純増（253/0・458/0…）で足りている。
     *
     * 代わりに、それぞれの「いまの形」を明文化して見張る（字下げ幅を変えても行数は
     * 動かないので、行数の比較は**構造の作り直しにだけ**反応する）:
     *   stages.json   … 素の整形と**完全一致**すること（不動点であること自体が安全の理由なので、
     *                    ずれたら知りたい。ただし手で足しただけで鳴るのは行き過ぎなので**警告どまり**）
     *   reactions.json … 素の整形より**短い**こと（手で詰めてあるため。
     *                    書き戻されると 2,653 → 9,439 行に膨らむ ＝ ここが本当の危険） */
    const plainOf = a => JSON.stringify(a, null, 2).replace(/\n/g, '\r\n') + '\r\n';
    const lineCount = s => s.replace(/\r\n$/, '').split('\r\n').length;

    const sRaw = fs.readFileSync(path.join(ROOT, 'stages.json'), 'utf8');
    const sPlain = plainOf(JSON.parse(sRaw));
    if (sRaw !== sPlain) {
        warnings.push(`stages.json: 素の整形（JSON.stringify(x, null, 2)）と一致しなくなりました` +
            `（${lineCount(sRaw)} 行 / 素の整形は ${lineCount(sPlain)} 行）。` +
            `一致している限り書き戻しても差分が出ない ＝ compounds.json のような全書き換え事故が起きない`);
    }

    const rRaw = fs.readFileSync(path.join(ROOT, 'reactions.json'), 'utf8');
    const rNow = lineCount(rRaw);
    const rPlain = lineCount(plainOf(JSON.parse(rRaw)));
    if (rNow >= rPlain) {
        problems.push(`reactions.json: 手で詰めた形が失われています` +
            `（${rNow} 行。素の整形は ${rPlain} 行で、本来はそれより短いはず）` +
            `＝ JSON.stringify で書き戻された疑い。1件が機構の全ステップなので、` +
            `膨らむと巻矢印を1手ずつ読むレビューが成立しない`);
    }

    /* --- narrowing-problems.json: 1問1行（2026-08-26 にここへ入れた）---
     *
     * ⚠ **compounds.json とは逆側の失敗をしていた**。あちらは1件が92行に膨らんで
     * 84,890 行の差分になったが、こちらは **`JSON.stringify` そのままの改行ゼロ1行**で、
     * **何を直しても `git diff --numstat` が必ず `1 1`** だった。
     * 東大の札を1枚差し替えたのか、全問を作り直したのかが**差分から読めない** ——
     * 膨らむのと潰れるのは、どちらも**人のレビューが効かない**という同じ害。
     *
     * ⚠ このファイルは `narrowing.js` が `fetch(..., {cache:'no-cache'})` で読むので
     * `?v=` が付かず、**`verify-release.js` の対象外**（＝機械の見張りが1つも無かった）。
     * ここが唯一の見張りになる。
     *
     * 形: 1行目が `{"_readme":…,"problems":[` / 2行目以降が1問1行 / 最終行が `]}`
     *     ＝ **19問なら 21 行**（件数 + 2）。書き出しは
     *     `_解析/tools/build-narrowing-data.js`（**あちらを直したらここも直す**） */
    const nRaw = fs.readFileSync(path.join(ROOT, 'narrowing-problems.json'), 'utf8');
    const nArr = JSON.parse(nRaw).problems;
    const nWhere = 'narrowing-problems.json';
    const nHOW = '（規約: 1行目が {"_readme":…,"problems":[ ／ 1問＝1行 ／ 最終行が ]}）';
    if (nRaw.charCodeAt(0) === 0xFEFF) problems.push(`${nWhere}: BOM が付いています（UTF-8 BOM なしが規約）`);
    const nCrlf = (nRaw.match(/\r\n/g) || []).length, nLf = (nRaw.match(/\n/g) || []).length;
    if (nCrlf !== nLf) problems.push(`${nWhere}: 改行が CRLF で揃っていません（CRLF ${nCrlf} / LF ${nLf}）`);
    const nLines = nRaw.replace(/\r\n$/, '').split('\r\n');
    if (nLines.length !== nArr.length + 2) {
        problems.push(`${nWhere}: 1問1行になっていません` +
            `（${nArr.length} 問なのに ${nLines.length} 行。期待は ${nArr.length + 2} 行）` +
            `${nLines.length === 1 ? '＝ JSON.stringify そのままで書き出された疑い。' +
                'この形だと差分がいつも 1 1 になり、何を直したのか読めない' : ''}${nHOW}`);
    } else {
        if (!nLines[0].startsWith('{"_readme":') || !nLines[0].endsWith('"problems":[')) {
            problems.push(`${nWhere}: 1行目が {"_readme":… で始まり "problems":[ で終わっていません${nHOW}`);
        }
        if (nLines[nLines.length - 1] !== ']}') problems.push(`${nWhere}: 最終行が "]}" 単独ではありません${nHOW}`);
        for (let i = 0; i < nArr.length; i++) {
            const L = nLines[i + 1], tail = i === nArr.length - 1 ? '}' : '},';
            if (!L.startsWith('{') || !L.endsWith(tail)) {
                problems.push(`${nWhere}: ${i + 2} 行目（${nArr[i].id}）が ` +
                    `"{" で始まり "${tail}" で終わる1問になっていません${nHOW}`);
                break;
            }
        }
    }
}
checkLayout();

const entries = [
    // ステージ側の stereo も渡す（アプリの getCompoundLibrary と同じ）。落とすと
    // 立体指定つきのステージ（D-グルコース（鎖状））が立体なし扱いになり、判定がずれる
    ...loadJson('stages.json').filter(s => s.target).map(s => ({ name: s.name, target: s.target, stereo: s.stereo, source: 'stages.json' })),
    ...loadJson('compounds.json').map(c => ({ name: c.name, target: c.target, stereo: c.stereo, source: 'compounds.json' }))
];

const seen = new Map();
entries.forEach(entry => {
    const where = `${entry.source} / ${entry.name}`;
    let info;
    try {
        info = stereoCodeOf(entry);
    } catch (e) {
        problems.push(`${where}: 分子を構築できません（${e.message}）`);
        return;
    }
    // 1. 価標
    info.mol.atoms.forEach(a => {
        if (!W.isValencyValid(info.mol, a.id)) {
            problems.push(`${where}: ${a.element} の価標が超過しています（(${Math.round(a.x)},${Math.round(a.y)})）`);
        }
    });
    // 2. 近すぎる原子
    const { minHeavy, minAll } = minDistances(info.mol);
    if (minHeavy < HEAVY_MIN) {
        problems.push(`${where}: 重原子どうしが近すぎます（最小 ${minHeavy.toFixed(1)}px < ${HEAVY_MIN}px）`);
    }
    if (minAll < HYDROGEN_MIN) {
        problems.push(`${where}: 自動水素を含めて近すぎます（最小 ${minAll.toFixed(1)}px < ${HYDROGEN_MIN}px）`);
    } else if (minAll < HYDROGEN_WARN) {
        warnings.push(`${where}: 自動水素がやや近い（${minAll.toFixed(1)}px）`);
    }
    // 2b. 自動水素が結合線の下（§10-7・v1240）。**2 とは別項目**（測っている量が違う）
    const hLine = minHydrogenBondGap(info.mol);
    if (hLine.gap < HYDROGEN_LINE_MIN) {
        problems.push(`${where}: 自動水素が結合線の下に来ています` +
            `（${hLine.gap.toFixed(1)}px < ${HYDROGEN_LINE_MIN}px・${hLine.detail}）`);
    }
    // 3. 命名の一意性（正準コード＋立体コード）
    const key = info.code + '|' + (info.stereoCode || '');
    if (seen.has(key) && seen.get(key) !== entry.name) {
        problems.push(`${where}: 「${seen.get(key)}」と区別できません（構造も立体も同一）`);
    } else {
        seen.set(key, entry.name);
    }
    // 4. 硫黄の価数（v283 で文脈依存にした。S=O を持てば6価、なければ2価）。
    //    以前は「S は6価固定なのでチオールは登録できない」という検査だったが、
    //    価数を直したので**検査の前提が古くなった**。いまは「文脈どおりの価数か」を見る。
    //    スルホ基は置換しきって空き0、チオール -SH は水素1つが正しい
    info.mol.atoms.forEach(a => {
        if (a.element !== 'S') return;
        const hasSulfonyl = info.mol.getNeighbors(a.id)
            .some(n => n.type === 2 && n.atom.element === 'O');
        const free = info.mol.getFreeValency(a.id);
        const used = info.mol.getUsedValency(a.id);
        if (hasSulfonyl && used + free !== 6) {
            problems.push(`${where}: S=O を持つ硫黄の価標が ${used + free}（スルホ基は6価）`);
        }
        if (!hasSulfonyl && used + free !== 2) {
            problems.push(`${where}: S=O を持たない硫黄の価標が ${used + free}` +
                `（チオール・チオエーテル・ジスルフィドは2価。6価のままなら余分な水素が描かれます）`);
        }
    });
    // 5. 立体記述子の妥当性
    if (entry.stereo && !info.stereoCode) {
        problems.push(`${where}: stereo が指定されているのに立体コードを作れません`);
    }
    const hasFaceData = entry.target.atoms.some(a => a.haworthFace === 1 || a.haworthFace === -1);
    if (hasFaceData && info.ringReadable === 0) {
        problems.push(`${where}: haworthFace があるのに環の立体を読み取れません（環の構成が非標準の可能性）`);
    }
});

console.log(`検査した化合物: ${entries.length} 件`);
if (warnings.length) {
    console.log(`△ 警告 ${warnings.length} 件（不合格ではない。既存データにも同程度のものがある）:`);
    warnings.forEach(w => console.log('  - ' + w));
}
if (problems.length === 0) {
    console.log('✅ 不合格の問題はありません');
    process.exit(0);
}
console.log(`❌ ${problems.length} 件の問題:`);
problems.forEach(p => console.log('  - ' + p));
process.exit(1);
