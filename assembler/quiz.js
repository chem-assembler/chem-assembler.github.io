/**
 * 学習クイズ（P8-3 / P8-4 / P8-5調整）
 * - SameCompoundQuiz: 表記が異なる2つの構造式を並べ「同じ化合物か」を答えさせる
 * - NamingQuiz: 意図的に崩した表記の構造式を提示し、名称を4択で答えさせる
 * 共通機能: シリーズによる出題範囲の絞り込み、崩し方の強度（弱/標準/強）、
 * describeStructure による構造ポイントの解説。
 * 問題は既存ライブラリ（stages.json + compounds.json）から自動生成し、
 * 正誤の正は verifyMolecule（トポロジー同値）に置く。
 */

// ===== 共有ヘルパー =====

// 出題用ライブラリ { name, series, target, mol, formula } を構築する
function buildCompoundLibrary(game) {
    const entries = [
        ...STAGES.map(s => ({ name: s.name, series: s.series, target: s.target })),
        ...COMPOUNDS.map(c => ({ name: c.name, series: 'その他の有名化合物', target: c.target }))
    ];
    return entries.map(e => {
        const mol = game.createTargetFromData({ target: e.target });
        return { name: e.name, series: e.series, target: e.target, mol, formula: game.computeMolecularFormula(mol) };
    });
}

/**
 * 選択肢の答え合わせを塗る（2026-08-09）。**選んだものと正解の両方を画面に残す**。
 *
 * それまでは結果メッセージの文が色を変えるだけで、**どのボタンを押したのかが残らなかった**。
 * SNS 動画の検品で分かった（押した瞬間しか手がかりが無く、静止画にすると読み取れない）。
 * 学習面でも、間違えた直後に「自分は何を選んだか」が消えるのは具合が悪い。
 *
 * @param buttons  選択肢のボタン列
 * @param isRight  そのボタンが正解か（(btn) => boolean）
 * @param picked   ユーザーが押したボタン。分からなければ null
 */
function markQuizChoices(buttons, isRight, picked) {
    [...buttons].forEach(b => {
        b.disabled = true;
        b.classList.remove('quiz-choice-right', 'quiz-choice-wrong', 'quiz-choice-muted', 'quiz-choice-picked');
        if (isRight(b)) {
            b.classList.add('quiz-choice-right');
            if (b === picked) b.classList.add('quiz-choice-picked');
        } else if (b === picked) {
            b.classList.add('quiz-choice-wrong');
        } else {
            b.classList.add('quiz-choice-muted');
        }
    });
}

// シリーズ選択ドロップダウンを構築する（初回のみ）
function populateSeriesSelect(selectEl, library) {
    if (selectEl.options.length > 0) return;
    const seriesList = [];
    library.forEach(e => {
        if (!seriesList.includes(e.series)) seriesList.push(e.series);
    });
    const all = document.createElement('option');
    all.value = 'all';
    all.textContent = 'すべて';
    selectEl.appendChild(all);
    seriesList.forEach(s => {
        const o = document.createElement('option');
        o.value = s;
        o.textContent = s;
        selectEl.appendChild(o);
    });
}

// 配列をシャッフルした新しい配列を返す（Fisher–Yates）
function shuffleArray(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// 崩し方の強度設定（0=弱: 回転・反転のみ / 1=標準 / 2=強）
const TRANSFORM_LEVELS = [
    { kekuleProb: 0.0, stretchPasses: 0, stretchProb: 0.0, maxStretchUnits: 1, bendPasses: 0, bendProb: 0.0 },
    { kekuleProb: 0.5, stretchPasses: 1, stretchProb: 0.5, maxStretchUnits: 1, bendPasses: 1, bendProb: 0.6 },
    { kekuleProb: 1.0, stretchPasses: 2, stretchProb: 1.0, maxStretchUnits: 2, bendPasses: 3, bendProb: 1.0 }
];

// トポロジーを変えずに表記だけを変える（回転・反転・ケクレ位相反転・橋結合の伸長）
function transformCompoundDepiction(target, strength = 1) {
    const conf = TRANSFORM_LEVELS[strength] || TRANSFORM_LEVELS[1];
    const atoms = target.atoms.map(a => ({ ...a }));
    const bonds = target.bonds.map(b => ({ ...b }));

    // 図から読み取れる立体（フィッシャーの十字・ハースの上下・C=Cのシス/トランス）。
    // これらは**画面上の絶対的な向き**で決まる規約なので、90°回転や左右反転で意味が変わる。
    // 変形のたびに読み直し、**変わっていない配置だけを採用する**（生成側の意図を信用しない）。
    // ユーザー報告: α-D-マンノースの比較で、90°回転した図が「同じ化合物」と誤判定された。
    // 実測では 185件中29件が回転で別の立体異性体の図になっていた（α-D-マンノースは30回中24回）
    // pts は座標だけの配列（{x, y}）で渡ってくるので、元素は元の atoms から引く。
    // ここで element を取り違えると読み取りが常に null になり、
    // 「立体が保存できない」と判断して**全候補を弾いてしまう**（実際に一度そうなった）
    const stereoSignature = (pts) => {
        if (typeof readAtomParityFromFischer !== 'function') return null;
        const mm = new Molecule();
        const ids = pts.map((p, i) => {
            const na = mm.addAtom(atoms[i].element, p.x, p.y);
            // ハースの面マークは座標に現れないデータなので復元する。
            // 忘れると環の立体が読めず、実際の描画より**甘い判定**になる
            // （createTargetFromData と同じ扱いにそろえる）
            const f = atoms[i].haworthFace;
            if (f === 1 || f === -1) na.haworthFace = f;
            return na.id;
        });
        bonds.forEach(b => mm.addBond(ids[b.atom1Index], ids[b.atom2Index], b.type));
        const info = readStereoOf(mm);
        return info ? info.stereoCode : null;
    };
    const baseStereo = stereoSignature(atoms);
    // 立体が読めない分子（ふつうの構造式）は制約なし。読める分子だけ照合する
    const keepsStereo = (pts) => baseStereo === null || stereoSignature(pts) === baseStereo;

    // 1. 90°単位の回転（0〜3回）＋左右反転（剛体変換なのでシス/トランスは保存される）。
    //    フィッシャー・ハースは保存されないので、**立体の読みが変わらない向きだけ**から選ぶ
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const rigid = (turns, mirror) => atoms.map(a => {
        let x = a.x, y = a.y;
        for (let t = 0; t < turns; t++) {
            const nx = cx - (y - cy);
            const ny = cy + (x - cx);
            x = nx; y = ny;
        }
        if (mirror) x = 2 * cx - x;
        return { x, y };
    });
    const poses = [];
    for (let t = 0; t < 4; t++) for (const mir of [false, true]) poses.push({ t, mir });
    for (let i = poses.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [poses[i], poses[j]] = [poses[j], poses[i]];
    }
    // 立体が読めない分子では、従来どおり必ず向きを変える（t=0かつ反転なしは選ばない）
    const allowed = poses.filter(p => baseStereo !== null || p.t > 0 || p.mir);
    for (const p of allowed) {
        const pts = rigid(p.t, p.mir);
        if (!keepsStereo(pts)) continue;
        pts.forEach((q, i) => { atoms[i].x = q.x; atoms[i].y = q.y; });
        break;
    }

    // 2. ベンゼン環があればケクレ位相を反転（環内の単⇔二重を入れ替え。同値な表記）
    const m = new Molecule();
    const added = atoms.map(a => m.addAtom(a.element, a.x, a.y));
    bonds.forEach(b => m.addBond(added[b.atom1Index].id, added[b.atom2Index].id, b.type));
    const arKeys = findAromaticBondKeys(m);
    if (arKeys.size > 0 && Math.random() < conf.kekuleProb) {
        const keyOf = (b) => {
            const id1 = added[b.atom1Index].id;
            const id2 = added[b.atom2Index].id;
            return id1 < id2 ? `${id1}_${id2}` : `${id2}_${id1}`;
        };
        const targets = bonds.filter(b => arKeys.has(keyOf(b)));
        const flip = () => targets.forEach(b => {
            b.type = (b.type === 1 ? 2 : 1);
            const mb = m.getBond(added[b.atom1Index].id, added[b.atom2Index].id);
            if (mb) mb.type = b.type;
        });
        flip();
        // 縮合環（ナフタレン等）では、芳香族結合を一律に反転すると環の共有原子が
        // 5本結合になってしまう（単環ならもう一方のケクレ構造として妥当）。
        // 妥当な場合のみ採用し、そうでなければ元に戻す（P9-5 夜間監査で発見）
        if (!m.atoms.every(a => isValencyValid(m, a.id))) flip();
    }

    // 配置が図として読めるかの判定。**原子どうしの距離だけでは足りない**。
    // 伸長で結合が2〜3マス分に伸びると、その線の途中に無関係な原子が乗ることがあり、
    // 「カルボキシ基のOが中心炭素に直接ついている」ように見える図が出る
    // （ユーザー報告。グリシンで実測500回中192回、原子が結合線の真上=0.0px に載っていた）。
    // 直交格子なので、線に乗るときは 0px、乗らなければ 42px 以上とほぼ二値になる
    const distToSegment = (p, a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        if (L2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    };
    // 配置の「読みにくさ」＝いちばん詰まっている隙間（原子どうし・原子と結合線の両方）
    const tightestGap = (pts) => {
        let g = Infinity;
        for (let i = 0; i < pts.length; i++) {
            for (let j = i + 1; j < pts.length; j++) {
                g = Math.min(g, Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y));
            }
        }
        for (const bd of bonds) {
            const A = pts[bd.atom1Index], B = pts[bd.atom2Index];
            for (let i = 0; i < pts.length; i++) {
                if (i === bd.atom1Index || i === bd.atom2Index) continue;
                g = Math.min(g, distToSegment(pts[i], A, B));
            }
        }
        return g;
    };
    // 合格ラインは絶対値ではなく「元の図と同じ読みやすさを保つ」こと。
    // ハース環のテンプレートは元から26pxの隙間を持つので（ライブラリ全185件中7件）、
    // 一律 27.3px を要求すると糖の問題だけ変形の選択肢が激減してしまう
    const gapFloor = Math.min(GRID_SIZE * 0.65, tightestGap(atoms.map(a => ({ x: a.x, y: a.y }))));
    // 伸長・屈曲でも同じ2条件を課す。屈曲は枝を90°回すので、
    // 不斉炭素のまわりの向きが変わって立体の読みが変わりうる
    const isReadableLayout = (pts) => tightestGap(pts) >= gapFloor - 0.001 && keepsStereo(pts);

    // 3. 橋結合の伸長（強度に応じて回数・距離が増える。重なる場合は行わない）
    for (let pass = 0; pass < conf.stretchPasses; pass++) {
        if (Math.random() >= conf.stretchProb || bonds.length === 0) continue;
        const adj = atoms.map(() => []);
        bonds.forEach((b, bi) => {
            adj[b.atom1Index].push({ to: b.atom2Index, bi });
            adj[b.atom2Index].push({ to: b.atom1Index, bi });
        });
        const reach = (start, excludeBi) => {
            const seen = new Set([start]);
            const stack = [start];
            while (stack.length) {
                const i = stack.pop();
                adj[i].forEach(e => {
                    if (e.bi === excludeBi || seen.has(e.to)) return;
                    seen.add(e.to);
                    stack.push(e.to);
                });
            }
            return seen;
        };
        const bridges = [];
        bonds.forEach((b, bi) => {
            if (!reach(b.atom1Index, bi).has(b.atom2Index)) bridges.push(bi);
        });
        if (bridges.length === 0) continue;
        const bi = bridges[Math.floor(Math.random() * bridges.length)];
        const b = bonds[bi];
        const side = reach(b.atom2Index, bi);
        const a1 = atoms[b.atom1Index];
        const a2 = atoms[b.atom2Index];
        const len = Math.hypot(a2.x - a1.x, a2.y - a1.y) || 1;
        const units = 1 + Math.floor(Math.random() * conf.maxStretchUnits);
        const dx = (a2.x - a1.x) / len * GRID_SIZE * units;
        const dy = (a2.y - a1.y) / len * GRID_SIZE * units;
        const moved = atoms.map((a, i) => side.has(i) ? { x: a.x + dx, y: a.y + dy } : { x: a.x, y: a.y });
        if (isReadableLayout(moved)) {
            moved.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
        }
    }

    // 4. 主鎖の屈曲（P9-4）: 橋結合を選び、その先の枝全体を結合点まわりに90°回転させる。
    //    「主鎖が一直線でない」描き方を作る（直交作図のまま曲げるので手書き感覚を保つ）。
    //    多重結合（sp2/sp の120°/180°作図）を含む枝は、慣習的な作図が崩れるため回さない。
    // 重原子が一直線に並んでいるか（屈曲したかどうかの判定に使う）
    const isCollinear = () => {
        const heavy = atoms.filter(a => a.element !== 'H');
        if (heavy.length < 3) return true;
        return new Set(heavy.map(a => Math.round(a.y))).size === 1 ||
               new Set(heavy.map(a => Math.round(a.x))).size === 1;
    };
    const tryBend = (requireBent) => {
        if (bonds.length === 0) return;
        const adj = atoms.map(() => []);
        bonds.forEach((b, bi) => {
            adj[b.atom1Index].push({ to: b.atom2Index, bi });
            adj[b.atom2Index].push({ to: b.atom1Index, bi });
        });
        const reach = (start, excludeBi) => {
            const seen = new Set([start]);
            const stack = [start];
            while (stack.length) {
                const i = stack.pop();
                adj[i].forEach(e => {
                    if (e.bi === excludeBi || seen.has(e.to)) return;
                    seen.add(e.to);
                    stack.push(e.to);
                });
            }
            return seen;
        };
        // 回転の軸になりうる結合: 橋（切ると2つに分かれる）かつ単結合
        const candidates = [];
        bonds.forEach((b, bi) => {
            if (b.type !== 1) return;
            const side2 = reach(b.atom2Index, bi);
            if (side2.has(b.atom1Index)) return; // 環内結合は対象外
            const side1 = reach(b.atom1Index, bi);
            [[b.atom1Index, side2], [b.atom2Index, side1]].forEach(([pivotIdx, movingSet]) => {
                // 回す側が1原子でも許す（P12-8。ユーザー指摘「結合が伸びただけの問題が出やすい」）。
                // 以前は2原子以上に限っていたため、**炭素3個の鎖（プロパン・ジメチルエーテル・
                // エチルアミン等）は曲げようがなく**、伸長だけの問題になっていた。
                // 端の1原子を90°回すのは「主鎖を曲げて描く」そのもので、教科書の書き方に沿う
                if (movingSet.size < 1 || movingSet.size === atoms.length) return;
                // 回す側に多重結合が含まれるなら見送る（120°/180°の作図を壊さない）
                const movingHasMultiple = bonds.some(bb => bb.type > 1 &&
                    movingSet.has(bb.atom1Index) && movingSet.has(bb.atom2Index));
                if (movingHasMultiple) return;
                candidates.push({ pivotIdx, movingSet });
            });
        });
        if (candidates.length === 0) return;
        // 候補と回転方向をランダム順に試し、重ならない曲げ方が見つかった時点で確定する
        const trials = [];
        candidates.forEach(cand => [1, -1].forEach(dir => trials.push({ cand, dir })));
        for (let i = trials.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [trials[i], trials[j]] = [trials[j], trials[i]];
        }
        for (const { cand, dir } of trials) {
            const pivot = atoms[cand.pivotIdx];
            const rotated = atoms.map((a, i) => {
                if (!cand.movingSet.has(i)) return { x: a.x, y: a.y };
                const rx = a.x - pivot.x;
                const ry = a.y - pivot.y;
                return { x: pivot.x - dir * ry, y: pivot.y + dir * rx }; // 90°回転
            });
            if (!isReadableLayout(rotated)) continue;
            if (requireBent) {
                // 曲げ直しの最終試行では、結果が一直線に戻る曲げ方は採用しない
                const before = atoms.map(a => ({ x: a.x, y: a.y }));
                rotated.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
                if (!isCollinear()) return;
                before.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
                continue;
            }
            rotated.forEach((p, i) => { atoms[i].x = p.x; atoms[i].y = p.y; });
            return;
        }
    };

    for (let pass = 0; pass < conf.bendPasses; pass++) {
        if (Math.random() >= conf.bendProb) continue;
        tryBend(false);
    }
    // 曲げたつもりが打ち消し合って一直線に戻ることがあるため、最後に一度だけ曲げ直す
    if (conf.bendPasses > 0 && isCollinear()) tryBend(true);

    return { atoms, bonds };
}

// 分子を指定SVG（.quiz-bonds / .quiz-atoms グループを持つ）に描画し、判定用Moleculeを返す
/**
 * 表示専用に、**直線に並んだメチレン鎖を畳んだ作図データ**を作る（レビュー項目25・第1段）。
 * `DESIGN_chain_condense.md` の決めごとに従う。**元の target は変えない**
 * （変えると正準コード・立体の読み・保存が全部ずれる）。
 *
 * 畳む条件: 重原子の隣がちょうど2つ・どちらも単結合の炭素・置換基なし・**3個以上**続く・
 * **一直線に並んでいる**。`-CH₂-` が2つのHを持つので**不斉炭素にはなりえず**、
 * 一直線なら環にもならない ＝ 立体を壊す心配がない。
 *
 * **ラベルに置き換えるだけでは図の幅は縮まらない**（両端の原子は元の座標のまま）。
 * 畳んだぶんだけ向こう側をまとめて手前に寄せる。曲がった鎖を対象外にしているのは、
 * この移動先が一意に決まらないため。
 *
 * 畳めるものが無ければ null（呼び出し側は元の target をそのまま描く）。
 */
/**
 * 畳める「まっすぐな -CH₂- の並び」を見つけるだけの関数（項目25。座標は動かさない）。
 *
 * **検出と変形を分けてあるのは、キャンバス側（第2段）が変形を要らないから。**
 * クイズの図（第1段）は「畳んだぶん向こう側を手前に寄せて幅を縮める」が、
 * キャンバスでは**原子を動かすと当たり判定がずれる**（そこにある原子をタップして編集する）。
 * キャンバス側は「隠してラベルを1枚置く」だけでよいので、検出だけを共有する。
 *
 * 返すのは `[{ run, a, b, ux, uy, len, comp }]`:
 *   run … 畳める CH₂ の添字（並び順）／a・b … 鎖の両端に付いている「鎖でない原子」
 *   ux,uy,len … a→b の向きと距離／comp … b 側の連結成分（寄せるときに動かす範囲）
 *
 * 畳む条件（1つでも外れたら畳まない）:
 *   重原子の隣がちょうど2つで両方とも単結合の炭素／`minRun` 個以上続く／
 *   **一直線に並んでいる**（曲がった鎖はどこへ折り返すか決まらない）／
 *   両端に鎖でない原子が付いている（分子の末端は畳まない）／**環でない**
 */
function findCondensableChainRuns(target, minRun = 3) {
    const atoms = target.atoms;
    const adj = atoms.map(() => []);
    target.bonds.forEach(b => {
        adj[b.atom1Index].push({ i: b.atom2Index, type: b.type });
        adj[b.atom2Index].push({ i: b.atom1Index, type: b.type });
    });
    const isPlainCH2 = i => atoms[i].element === 'C' && adj[i].length === 2 &&
        adj[i].every(n => n.type === 1);

    // 続いている CH₂ のかたまり（連結成分）を取り出し、1本の道として並べ直す
    const inRun = i => isPlainCH2(i);
    const nbrsInRun = i => adj[i].map(n => n.i).filter(inRun);
    const runs = [];
    const seen = new Set();
    for (let i = 0; i < atoms.length; i++) {
        if (!inRun(i) || seen.has(i)) continue;
        const comp = [i];
        seen.add(i);
        for (let k = 0; k < comp.length; k++) {
            nbrsInRun(comp[k]).forEach(j => {
                if (!seen.has(j)) { seen.add(j); comp.push(j); }
            });
        }
        // 端（かたまりの中での隣が1つ以下）から並べる。端が無ければ環なので畳まない
        const start = comp.find(j => nbrsInRun(j).length <= 1);
        if (start === undefined) continue;
        const path = [start];
        let prev = -1, cur = start;
        for (;;) {
            const next = nbrsInRun(cur).find(j => j !== prev);
            if (next === undefined) break;
            path.push(next); prev = cur; cur = next;
        }
        if (path.length >= minRun) runs.push(path);
    }
    if (!runs.length) return [];

    const found = [];
    for (const run of runs) {
        // 鎖の両端にぶら下がっている「鎖でない原子」を見つける
        const ends = [run[0], run[run.length - 1]];
        const outside = ends.map((e, k) => {
            const other = k === 0 ? run[1] : run[run.length - 2];
            return adj[e].map(n => n.i).find(j => j !== other && !run.includes(j));
        });
        if (outside.some(v => v === undefined)) continue; // 端が開いている（分子の末端）＝畳まない
        const [A, B] = outside;
        if (A === B) continue; // 環
        // 一直線か（A・鎖・B が同じ直線に並び、間隔が一定）
        const line = [A, ...run, B].map(i => atoms[i]);
        const dx = line[line.length - 1].x - line[0].x, dy = line[line.length - 1].y - line[0].y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const ux = dx / len, uy = dy / len;
        const straight = line.every(p => Math.abs((p.x - line[0].x) * uy - (p.y - line[0].y) * ux) < 1);
        if (!straight) continue;
        // B 側の連結成分（鎖を通らずに B から届く原子）。A へ回り込めるなら環なので畳まない
        const comp = new Set([B]);
        const stack = [B];
        let ring = false;
        while (stack.length) {
            const cur = stack.pop();
            for (const n of adj[cur]) {
                if (run.includes(n.i)) continue;
                if (n.i === A) { ring = true; break; }
                if (!comp.has(n.i)) { comp.add(n.i); stack.push(n.i); }
            }
            if (ring) break;
        }
        if (ring) continue;
        found.push({ run, a: A, b: B, ux, uy, len, comp: [...comp] });
    }
    return found;
}

/**
 * 畳んだ表示用の座標を作る（クイズの図・第1段）。**検出は findCondensableChainRuns に任せる。**
 * ここは「鎖を消して A–B を1本にし、**畳んだぶん B 側を手前へ寄せる**」変形だけを担当する。
 * 寄せないとラベルに置き換えても図の広がりが変わらない（設計書 DESIGN_chain_condense.md）。
 */
function condenseChainForDisplay(target, minRun = 3) {
    const found = findCondensableChainRuns(target, minRun);
    if (!found.length) return null;
    const atoms = target.atoms;
    const out = { atoms: atoms.map(a => Object.assign({}, a)), bonds: target.bonds.map(b => Object.assign({}, b)), labels: [] };
    const removed = new Set();
    let changed = false;

    for (const { run, a: A, b: B, ux, uy, len, comp } of found) {
        // 鎖を消して A–B を1本の結合にし、B 側を手前へ寄せる
        const step = Math.hypot(out.atoms[run[0]].x - out.atoms[A].x, out.atoms[run[0]].y - out.atoms[A].y);
        const shift = len - step * 2; // A と B のあいだをラベル1つぶん（刻み2つ）にする
        comp.forEach(i => { out.atoms[i].x -= ux * shift; out.atoms[i].y -= uy * shift; });
        run.forEach(i => removed.add(i));
        out.bonds = out.bonds.filter(b => !run.includes(b.atom1Index) && !run.includes(b.atom2Index));
        out.bonds.push({ atom1Index: A, atom2Index: B, type: 1 });
        const sub = String(run.length).split('').map(d => '₀₁₂₃₄₅₆₇₈₉'[+d]).join('');
        out.labels.push({
            x: (out.atoms[A].x + out.atoms[B].x) / 2,
            y: (out.atoms[A].y + out.atoms[B].y) / 2,
            text: `(CH₂)${sub}`
        });
        changed = true;
    }
    if (!changed) return null;

    // 消した原子を詰めて、結合の添字を振り直す
    const map = new Map();
    const keptAtoms = [];
    out.atoms.forEach((a, i) => {
        if (removed.has(i)) return;
        map.set(i, keptAtoms.length);
        keptAtoms.push(a);
    });
    return {
        atoms: keptAtoms,
        bonds: out.bonds.filter(b => map.has(b.atom1Index) && map.has(b.atom2Index))
            .map(b => ({ atom1Index: map.get(b.atom1Index), atom2Index: map.get(b.atom2Index), type: b.type })),
        labels: out.labels
    };
}

/**
 * @param condense 長い鎖を畳んで描くか（項目25・第1段）。**呼び出しごとに選ぶ**。
 * 「🎓 同じ化合物？」のように**図の形を見比べるのが問題そのもの**のクイズでは畳んではいけない。
 * あちらは主鎖をわざと曲げて出題するので、**曲がった側だけ畳まれず、同じ分子の2枚が
 * まったく違う絵になる**（畳む条件が「一直線」だから）。立体のクイズは向きを変えても
 * 一直線のままなので、そこでだけ畳む。
 */
function renderMoleculeIntoSvg(game, svgId, target, showWedge, condense) {
    const svg = document.getElementById(svgId);
    const bondsGroup = svg.querySelector('.quiz-bonds');
    const atomsGroup = svg.querySelector('.quiz-atoms');
    bondsGroup.innerHTML = '';
    atomsGroup.innerHTML = '';

    // 長い鎖は畳んで描く（レビュー項目25・第1段）。くさび図モードでは畳まない
    // （立体を見せる図なので中身を隠さない）。畳めるものが無ければ null で今までどおり
    const condensed = (condense && !showWedge) ? condenseChainForDisplay(target) : null;
    const drawn = condensed || target;
    const mol = game.createTargetFromData({ target: drawn });
    let hydrogens = mol.calculateHydrogens();
    if (showWedge) hydrogens = stretchStereoHydrogens(mol, hydrogens);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [...mol.atoms, ...hydrogens].forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 30;
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`);

    // くさび図モードでは、不斉炭素まわりの結合は**線ではなくくさび**で描く（下の drawWedges）
    const wedgeSet = showWedge ? wedgedBondKeys(mol, hydrogens) : null;
    const plain = (aId, bId) => !wedgeSet || !wedgeSet.has(aId + '|' + bId);

    hydrogens.forEach(h => {
        const parent = mol.atoms.find(a => a.id === h.parentId);
        if (parent && plain(h.parentId, 'H:' + h.x + ',' + h.y)) {
            game.renderTargetBond(parent.x, parent.y, h.x, h.y, 1, true, bondsGroup);
        }
    });
    mol.bonds.forEach(b => {
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (!a1 || !a2) return;
        if (!plain(b.atomId1, b.atomId2) || !plain(b.atomId2, b.atomId1)) return;
        game.renderTargetBond(a1.x, a1.y, a2.x, a2.y, b.type, false, bondsGroup);
    });
    if (showWedge) drawWedges(mol, hydrogens, bondsGroup);
    hydrogens.forEach(h => game.renderTargetAtom('H', h.x, h.y, atomsGroup));
    mol.atoms.forEach(a => game.renderTargetAtom(a.element, a.x, a.y, atomsGroup));
    // 畳んだ鎖の「(CH₂)ₙ」を、結合の上に台紙つきで置く（線と重なって読めなくならないように）
    if (condensed) {
        const NS = 'http://www.w3.org/2000/svg';
        condensed.labels.forEach(l => {
            const box = document.createElementNS(NS, 'rect');
            box.setAttribute('x', l.x - 30); box.setAttribute('y', l.y - 11);
            box.setAttribute('width', 60); box.setAttribute('height', 22);
            box.setAttribute('rx', 5);
            box.setAttribute('fill', 'rgba(15,20,28,0.95)');
            box.setAttribute('stroke', 'rgba(255,255,255,0.25)');
            atomsGroup.appendChild(box);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', l.x); t.setAttribute('y', l.y + 5);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'chain-condensed');
            t.textContent = l.text;
            atomsGroup.appendChild(t);
        });
    }
    return mol;
}

/**
 * くさび図モード（P12-8・項目17）で置き換える結合を集める。
 * フィッシャー投影は**縦が奥・横が手前**という規約を覚えていないと読めない。
 * その規約を図そのものに描き出して、脳内変換なしで立体を見比べられるようにする。
 * 対象は `readAtomParityFromFischer` が立体を読み取れた炭素の4本だけで、
 * **判定に使うのと同じ軸**（上下左右）から向きを決めるので、図とアプリの読みが食い違わない。
 */
function wedgedBondKeys(mol, hydrogens) {
    const keys = new Set();
    if (typeof readAtomParityFromFischer !== 'function') return keys;
    Object.keys(readAtomParityFromFischer(mol)).forEach(centerId => {
        mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H')
            .forEach(n => { keys.add(centerId + '|' + n.atom.id); keys.add(n.atom.id + '|' + centerId); });
        hydrogens.filter(h => h.parentId === centerId)
            .forEach(h => keys.add(centerId + '|H:' + h.x + ',' + h.y));
    });
    return keys;
}

/**
 * くさび図モードでだけ、不斉炭素の水素を重原子と同じ長さ（42px）まで伸ばす（表示専用）。
 * 通常の水素は 16px しかなく、そのままだと4本のうち1本だけくさびが 6px の豆粒になって、
 * 「4つの基が中心のまわりにどう並ぶか」を見る図にならない。
 * 伸ばした先に他の原子が来る図では**伸ばさない**（重なりを作ってまで揃えない）。
 */
function stretchStereoHydrogens(mol, hydrogens) {
    if (typeof readAtomParityFromFischer !== 'function') return hydrogens;
    const centers = Object.keys(readAtomParityFromFischer(mol));
    if (centers.length === 0) return hydrogens;
    const TARGET = 42, CLEAR = 20;
    return hydrogens.map(h => {
        if (centers.indexOf(h.parentId) < 0) return h;
        const c = mol.atoms.find(a => a.id === h.parentId);
        if (!c) return h;
        const dx = h.x - c.x, dy = h.y - c.y, len = Math.hypot(dx, dy);
        if (len < 1e-6 || len >= TARGET) return h;
        const nx = c.x + dx / len * TARGET, ny = c.y + dy / len * TARGET;
        const blocked = mol.atoms.some(a => a.id !== c.id && Math.hypot(a.x - nx, a.y - ny) < CLEAR)
            || hydrogens.some(o => o !== h && Math.hypot(o.x - nx, o.y - ny) < CLEAR);
        return blocked ? h : Object.assign({}, h, { x: nx, y: ny });
    });
}

/** 不斉炭素の4本を、手前＝塗りつぶしのくさび／奥＝破線のくさびで描く */
function drawWedges(mol, hydrogens, group) {
    if (typeof readAtomParityFromFischer !== 'function') return;
    const NS = 'http://www.w3.org/2000/svg';
    const FRONT = '#ffa502', BACK = '#78beff';
    Object.keys(readAtomParityFromFischer(mol)).forEach(centerId => {
        const c = mol.atoms.find(a => a.id === centerId);
        if (!c) return;
        const around = mol.getNeighbors(centerId).filter(n => n.atom.element !== 'H')
            .map(n => ({ x: n.atom.x, y: n.atom.y }))
            .concat(hydrogens.filter(h => h.parentId === centerId).map(h => ({ x: h.x, y: h.y })));
        around.forEach(p => {
            const dx = p.x - c.x, dy = p.y - c.y;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return;
            const ux = dx / len, uy = dy / len;      // 中心→相手
            const nx = -uy, ny = ux;                  // 直交
            const front = Math.abs(dx) > Math.abs(dy); // 横＝手前 / 縦＝奥
            // 原子ラベルにかからないよう、両端を空ける（結合長は 16px〜42px）
            const near = Math.min(9, len * 0.28);
            const far = len - Math.min(11, len * 0.32);
            const half = Math.min(5, (far - near) * 0.35);
            if (far <= near) return;
            const at = (t, s) => [c.x + ux * t + nx * s, c.y + uy * t + ny * s];
            if (front) {
                const [x1, y1] = at(near, 0), [x2, y2] = at(far, half), [x3, y3] = at(far, -half);
                const tri = document.createElementNS(NS, 'polygon');
                tri.setAttribute('points', `${x1},${y1} ${x2},${y2} ${x3},${y3}`);
                tri.setAttribute('fill', FRONT);
                group.appendChild(tri);
            } else {
                // 奥は破線のくさび。手前から遠ざかるほど横棒が長くなる
                const steps = 4;
                for (let i = 0; i < steps; i++) {
                    const t = near + (far - near) * (i / (steps - 1 || 1));
                    const s = half * (0.35 + 0.65 * (i / (steps - 1 || 1)));
                    const [xa, ya] = at(t, s), [xb, yb] = at(t, -s);
                    const ln = document.createElementNS(NS, 'line');
                    ln.setAttribute('x1', xa); ln.setAttribute('y1', ya);
                    ln.setAttribute('x2', xb); ln.setAttribute('y2', yb);
                    ln.setAttribute('stroke', BACK);
                    ln.setAttribute('stroke-width', '2');
                    ln.setAttribute('stroke-linecap', 'round');
                    group.appendChild(ln);
                }
            }
        });
    });
}

// ===== 「同じ化合物？」クイズ（P8-3） =====

/**
 * クイズの出題を外から指定するための読み取り（ORDER_stereo_puzzle.md の追加依頼・2026-08-03）。
 *
 * **なぜ要るか**: 「🎓 同じ化合物？」と立体異性体クイズは出題が乱数なので、SNS の収録が
 * 「答えを賭けて撮り、外れたら撮り直す」形になり、**1本あたり平均2テイク**かかっていた。
 * 系列（`#quiz-series`）と崩し方（`#quiz-strength`）は既に選べるので、
 * 足りないのは**答えを指定して出題する**入口だけ。
 *
 * **画面には出さない。** 入口の全体見直しが控えているので新しい UI は足さず、
 * URL パラメータ（`?quiz=same` / `?stereoQuiz=enantiomer`）と
 * `setForced()`、台本の `quizForce` アクションの3経路にとどめる。
 */
function readForcedFromUrl(key, allowed) {
    try {
        const v = new URLSearchParams(location.search).get(key);
        return allowed.includes(v) ? v : null;
    } catch (e) {
        return null;
    }
}

class SameCompoundQuiz {
    constructor(game) {
        this.game = game;
        this.library = null;
        this.allPairs = null;     // 全ライブラリでの「違う」ペア [i, j]
        this.poolIndices = null;  // シリーズ絞り込み後の出題インデックス
        this.pairs = null;        // 絞り込み後の「違う」ペア
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('quiz-modal');
        this.resultEl = document.getElementById('quiz-result');
        this.scoreEl = document.getElementById('quiz-score');
        this.btnSame = document.getElementById('btn-quiz-same');
        this.btnDiff = document.getElementById('btn-quiz-diff');
        this.seriesEl = document.getElementById('quiz-series');
        this.strengthEl = document.getElementById('quiz-strength');
        // 出題の指定（'same' / 'diff' / null）。null なら今までどおり乱数。
        // 収録が「答えを賭けて撮り、外れたら撮り直す」形になるのを止めるためのもの
        // （ORDER_stereo_puzzle.md の追加依頼。2026-08-03）
        this.forced = readForcedFromUrl('quiz', ['same', 'diff']);

        document.getElementById('btn-quiz').addEventListener('click', () => this.open());
        document.getElementById('btn-quiz-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-quiz-next').addEventListener('click', () => this.nextQuestion());
        this.seriesEl.addEventListener('change', () => { this.computePools(); this.nextQuestion(); });
        this.strengthEl.addEventListener('change', () => this.nextQuestion());
        this.btnSame.addEventListener('click', () => this.answer(true));
        this.btnDiff.addEventListener('click', () => this.answer(false));
    }

    strength() {
        return Number(this.strengthEl.value);
    }

    open() {
        this.buildLibrary();
        populateSeriesSelect(this.seriesEl, this.library);
        this.computePools();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    buildLibrary() {
        if (this.library) return;
        this.library = buildCompoundLibrary(this.game);
        // 「違う」問題用ペア: 分子式が同じでトポロジーが異なる（構造異性体）。
        // 同一トポロジーの別名エントリ（幾何異性・別表記）は除外する
        this.allPairs = [];
        for (let i = 0; i < this.library.length; i++) {
            for (let j = i + 1; j < this.library.length; j++) {
                if (this.library[i].formula !== this.library[j].formula) continue;
                if (verifyMolecule(this.library[i].mol, this.library[j].mol)) continue;
                this.allPairs.push([i, j]);
            }
        }
        this.computePools();
    }

    // シリーズ絞り込みを反映した出題プールを構築する
    computePools() {
        if (!this.library) return;
        const filter = this.seriesEl.value || 'all';
        this.poolIndices = this.library
            .map((e, i) => (filter === 'all' || e.series === filter) ? i : -1)
            .filter(i => i >= 0);
        const idxSet = new Set(this.poolIndices);
        this.pairs = this.allPairs.filter(([i, j]) => idxSet.has(i) && idxSet.has(j));
    }

    // 互換ラッパー（回帰テストから使用）
    get differentPairs() {
        return this.allPairs;
    }

    transformDepiction(target, strength = 1) {
        return transformCompoundDepiction(target, strength);
    }

    /** 出題を指定する（'same' / 'diff' / null で解除）。台本・URL・コンソールから使う */
    setForced(v) {
        this.forced = (v === 'same' || v === 'diff') ? v : null;
    }

    /** 1問ぶんの素材を作る。描画はしない（指定どおりか確かめてから描くため） */
    buildTargets(wantSame, strength) {
        const lib = this.library;
        if (wantSame) {
            const idx = this.poolIndices[Math.floor(Math.random() * this.poolIndices.length)];
            const entry = lib[idx];
            return { entryA: entry, entryB: entry, targetA: entry.target,
                     targetB: transformCompoundDepiction(entry.target, strength) };
        }
        let [i, j] = this.pairs[Math.floor(Math.random() * this.pairs.length)];
        if (Math.random() < 0.5) [i, j] = [j, i];
        // どちらも表記変換して「見た目の乱れ具合」では判別できないようにする
        return { entryA: lib[i], entryB: lib[j],
                 targetA: transformCompoundDepiction(lib[i].target, strength),
                 targetB: transformCompoundDepiction(lib[j].target, strength) };
    }

    nextQuestion() {
        if (!this.poolIndices || this.poolIndices.length === 0) this.computePools();
        const strength = this.strength();

        // 出題の指定があるときは、**作ったものが本当に指定どおりか `verifyMolecule` で
        // 確かめてから採用する**（生成の意図ではなく実際の関係で決める。
        // 「同じ？違う？」の StereoChoiceQuiz と同じ流儀）
        let built = null;
        for (let tries = 0; tries < 30 && !built; tries++) {
            const wantSame = this.pairs.length === 0 ? true
                : this.forced ? this.forced === 'same' : Math.random() < 0.5;
            const cand = this.buildTargets(wantSame, strength);
            if (!this.forced) { built = cand; break; }
            const a = this.game.createTargetFromData({ target: cand.targetA });
            const b = this.game.createTargetFromData({ target: cand.targetB });
            if (verifyMolecule(a, b) === (this.forced === 'same')) built = cand;
        }
        if (!built) {
            // 系列の絞り込みで「違う」の組が1つも無いときに起きる
            this.resultEl.textContent =
                `指定（${this.forced === 'same' ? '同じ' : '違う'}）で出題できる組が、いまの系列にありません。`;
            this.resultEl.className = '';
            return;
        }
        const { entryA, entryB, targetA, targetB } = built;

        const molA = renderMoleculeIntoSvg(this.game, 'quiz-svg-a', targetA);
        const molB = renderMoleculeIntoSvg(this.game, 'quiz-svg-b', targetB);

        // 正解フラグは verifyMolecule で決める（生成ロジックのバグに対する防御）
        this.current = {
            isSame: verifyMolecule(molA, molB),
            nameA: entryA.name,
            nameB: entryB.name,
            formula: entryA.formula,
            pointsA: describeStructure(molA),
            pointsB: describeStructure(molB)
        };
        this.showPremise(molA, molB);
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.btnSame.disabled = false;
        this.btnDiff.disabled = false;
        this.updateScore();
    }

    /**
     * この問題が何を問うているかを図の上に出す（P12-8。ユーザー指摘）。
     * フィッシャー投影やハース図の問題と、ただの平面図の問題が混在していて、
     * **どの前提で解けばよいのか画面に書いていなかった**。
     * このクイズの正解は `verifyMolecule`＝つながり方だけで決まるので、
     * 立体（手前・奥）を読む必要が無いことをはっきり言う。
     */
    showPremise(molA, molB) {
        const el = document.getElementById('quiz-premise');
        if (!el) return;
        const readable = (mol) => {
            if (typeof readStereoOf !== 'function') return null;
            try { return readStereoOf(mol); } catch (e) { return null; }
        };
        const a = readable(molA), b = readable(molB);
        // 立体の種類を取り違えないこと。**シス/トランスはフィッシャーではない**
        // （シス-2-ブテンを「フィッシャー投影」と書いてしまった実例あり）。
        //   環のパリティ  → ハース図（環の上下）
        //   不斉炭素      → フィッシャー投影（縦が奥・横が手前）
        //   C=C の幾何のみ → シス・トランス
        const kindOf = (info) => {
            if (!info) return null;
            if (info.centers > 0) return info.fromRing ? 'ハース図（環の上下）' : 'フィッシャー投影（縦が奥・横が手前）';
            if (info.geoms > 0) return 'C=C のシス・トランス';
            return null;
        };
        const kind = kindOf(a) || kindOf(b);
        if (kind) {
            const what = kind === 'C=C のシス・トランス' ? 'シス・トランスの違い' : '手前・奥';
            el.textContent = `この図は${kind}を表せる形で描かれていますが、この問題で見るのは` +
                `「原子のつながり方が同じか」だけです。${what}は問いません。`;
        } else {
            el.textContent = '平面の構造式です。回っていても曲がっていても、' +
                '原子のつながり方が同じなら「同じ化合物」です。';
        }
    }

    answer(saidSame) {
        if (!this.current || this.btnSame.disabled) return;
        markQuizChoices([this.btnSame, this.btnDiff],
            b => (b === this.btnSame) === this.current.isSame,
            saidSame ? this.btnSame : this.btnDiff);
        this.score.asked++;
        const correct = (saidSame === this.current.isSame);
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'same', correct: correct });

        const c = this.current;
        const head = correct ? '⭕ 正解！' : (c.isSame ? '❌ 残念…正解は「同じ」。' : '❌ 残念…正解は「違う」。');
        if (c.isSame) {
            this.resultEl.textContent =
                `${head} どちらも「${c.nameA}」（分子式 ${c.formula}）です。回転・反転・結合の長さや折れ曲がり・ベンゼンの二重結合の位置を変えても、原子のつながり方が同じなら同じ化合物です。\n` +
                `構造のポイント: ${c.pointsA.join('、')}`;
        } else {
            this.resultEl.textContent =
                `${head} 左は「${c.nameA}」、右は「${c.nameB}」。分子式はどちらも ${c.formula} ですが、原子のつながり方が異なる構造異性体です。\n` +
                `左: ${c.pointsA.join('、')}\n右: ${c.pointsB.join('、')}`;
        }
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// ===== 立体異性体クイズ（P12-8 M2.5） =====
//
// 「2つの図の関係は 同じ分子 / 鏡像異性体 / 別の立体異性体（ジアステレオマー）か」を答えさせる。
// **クイズの判定に CIP（R/S）は使わない**。P12-7 で作った立体コードの比較だけで足りる。
// ※ **判定そのものは実装済み**（`chemistry.js` の `cipRank` / `assignRSDescriptor`。
//    発注書 第4段 4b・v440）。ただしあれは**呼び名を出すため**のもので、
//    「同じ分子か」の同値関係には使わない ＝ ここは立体コードのままでよい。
//    2026-08-02 の方針変更（R/S を「やらないこと」から外した）に伴う書き換え。
// 立体コードの比較だけで判定できる理由:
//   立体コードが一致            → 同じ分子
//   片方の鏡像の立体コードが一致 → 鏡像異性体（エナンチオマー）
//   構造式は同じで上のどちらでもない → 別の立体異性体（ジアステレオマー）
// 出題は2通り。
//   (a) ライブラリの2エントリを並べる（D/L-アラニン、グルコース/ガラクトース、シス/トランスなど）
//   (b) 1つのエントリを**紙面内で回した図**と並べる。フィッシャー投影は
//       180°回すと同じ分子だが 90°回すと鏡像になる、という教科書の定番の落とし穴を
//       規則を書き込むのではなく「回した図から立体を読み直す」ことで自然に出す
// **正解は必ず、実際に描かれた2つの図から読んだ立体で決める**（生成側の意図は信用しない）。

// 立体が読める分子か調べ、読めたら記述子と立体コードを返す
function readStereoOf(mol) {
    if (typeof readAtomParityFromFischer !== 'function') return null;
    const atomParity = Object.assign({}, readAtomParityFromFischer(mol), readRingParityFromHaworth(mol));
    const bondGeo = readBondGeoFromCoords(mol);
    if (Object.keys(atomParity).length === 0 && Object.keys(bondGeo).length === 0) return null;
    const stereo = { atomParity, bondGeo };
    return {
        stereo,
        code: canonicalCode(mol),
        stereoCode: canonicalStereoCode(mol, stereo),
        mirrorCode: canonicalStereoCode(mol, mirrorStereo(stereo)),
        centers: Object.keys(atomParity).length,
        geoms: Object.keys(bondGeo).length,
        fromRing: Object.keys(readRingParityFromHaworth(mol)).length > 0
    };
}

/**
 * シス/トランスのある C=C を、直交作図（90°）ではなく **±120°** に整えた target を返す（P12-8）。
 * 作図モードの「⇄ シス/トランス整形」と同じ処理（game.reshapeDoubleBond）を、
 * 出題データに対して使う。実際の sp2 の形に近く、シス/トランスが読み取りやすくなる。
 * **整形で幾何が変わってしまった場合は元のまま返す**（見た目の調整で分子が変わってはいけない）。
 */
function reshapeGeometryForDisplay(game, target) {
    if (typeof bondGeoRefs !== 'function') return target;
    const mol = game.createTargetFromData({ target });
    const geoBonds = mol.bonds.filter(b => bondGeoRefs(mol, b));
    if (geoBonds.length === 0) return target;
    const before = readBondGeoFromCoords(mol);
    const saved = game.userMolecule;
    game.userMolecule = mol; // reshapeDoubleBond は userMolecule を見る
    try {
        geoBonds.forEach(b => {
            const subs = (id, other) => mol.getNeighbors(id)
                .filter(n => n.atom.id !== other && n.atom.element !== 'H')
                .map(n => n.atom);
            game.reshapeDoubleBond(b, subs(b.atomId1, b.atomId2), subs(b.atomId2, b.atomId1));
        });
    } catch (e) {
        game.userMolecule = saved;
        return target;
    }
    game.userMolecule = saved;
    const after = readBondGeoFromCoords(mol);
    const changed = Object.keys(before).some(k => before[k] !== after[k]) ||
        Object.keys(after).length !== Object.keys(before).length;
    if (changed) return target; // 幾何が変わったら採用しない
    return {
        atoms: target.atoms.map((a, i) => Object.assign({}, a,
            { x: Math.round(mol.atoms[i].x), y: Math.round(mol.atoms[i].y) })),
        bonds: target.bonds.map(b => Object.assign({}, b))
    };
}

// target（データ）を紙面内で回した／鏡に映した新しい target を返す（座標だけを変える）
function rotateTargetInPlane(target, quarterTurns, mirrorX = false) {
    const cx = target.atoms.reduce((s, a) => s + a.x, 0) / target.atoms.length;
    const cy = target.atoms.reduce((s, a) => s + a.y, 0) / target.atoms.length;
    const rot = ((quarterTurns % 4) + 4) % 4;
    const atoms = target.atoms.map(a => {
        let dx = a.x - cx, dy = a.y - cy;
        for (let i = 0; i < rot; i++) { const t = dx; dx = -dy; dy = t; } // 90°ずつ
        if (mirrorX) dx = -dx;
        return Object.assign({}, a, { x: Math.round(cx + dx), y: Math.round(cy + dy) });
    });
    return { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
}

class StereoQuiz {
    constructor(game) {
        this.game = game;
        this.pool = null;      // 立体が読めるエントリ
        this.pairs = null;     // ライブラリ内の [i, j]（構造式が同じ立体異性体の組）
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('stereo-quiz-modal');
        this.resultEl = document.getElementById('sq-result');
        this.scoreEl = document.getElementById('sq-score');
        this.buttons = {
            same: document.getElementById('btn-sq-same'),
            enantiomer: document.getElementById('btn-sq-enantiomer'),
            diastereomer: document.getElementById('btn-sq-diastereomer')
        };
        // 出題範囲（P12-8 M2.5・ユーザー要望）。フィッシャー投影を回す問題は
        // 規約（縦=奥・横=手前）を理解していないと解けないので、既定では出さず
        // 「発展」を選んだときだけ出す
        this.modeEl = document.getElementById('sq-mode');
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.nextQuestion());
        // 出題の指定（'same' / 'enantiomer' / 'diastereomer' / null）。→ readForcedFromUrl の説明
        this.forced = readForcedFromUrl('stereoQuiz', ['same', 'enantiomer', 'diastereomer']);
        // M2.5-A 重ね合わせビュー: 解答後に図Bのゴーストを図Aへ平行移動して重ね、
        // 立体の一致/不一致を中心ごとに示す（対応づけは座標ではなく正準ラベリング）
        this.overlayBtn = document.getElementById('btn-sq-overlay');
        this.overlayNoteEl = document.getElementById('sq-overlay-note');
        if (this.overlayBtn) this.overlayBtn.addEventListener('click', () => this.toggleOverlay());
        const btn = document.getElementById('btn-stereo-quiz');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-sq-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-sq-next').addEventListener('click', () => this.nextQuestion());
        Object.keys(this.buttons).forEach(k => this.buttons[k].addEventListener('click', () => this.answer(k)));
    }

    open() {
        this.build();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    build() {
        if (this.pool) return;
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info) this.pool.push(Object.assign({}, e, info));
        });
        // 構造式が同じ組だけを集める（分子が違えば立体の話にならない）
        this.pairs = [];
        for (let i = 0; i < this.pool.length; i++) {
            for (let j = i + 1; j < this.pool.length; j++) {
                if (this.pool[i].code !== this.pool[j].code) continue;
                if (this.pool[i].stereoCode === this.pool[j].stereoCode) continue; // 同名の重複エントリは使わない
                this.pairs.push([i, j]);
            }
        }
    }

    /** 2つの分子の関係を、描かれた図から読んだ立体だけで判定する */
    static relationOf(molA, molB) {
        const a = readStereoOf(molA);
        const b = readStereoOf(molB);
        if (!a || !b) return null;
        if (a.code !== b.code) return 'constitution'; // つながり方が違う（この問題では出さない）
        if (a.stereoCode === b.stereoCode) return 'same';
        if (a.mirrorCode === b.stereoCode) return 'enantiomer';
        return 'diastereomer';
    }

    // 出題候補を作る（回した図 or ライブラリの別エントリ）。作れなければ null
    makeCandidate() {
        // 「図を回す」出題は**フィッシャー投影（非環）に限る**。
        // ハース投影で紙面内180°回すと、規約どおりに読めば面が上下逆になり鏡像を描いた図に
        // なってしまう。理屈は同じだが教科書で扱う話ではなく、混乱を招くだけなので出さない
        // （環の分子はライブラリのペア＝α/βアノマー・エピマーで十分よい問題になる）
        const mode = this.modeEl ? this.modeEl.value : 'all';
        // くさび図モード（項目17・18）は**不斉炭素1個の鎖状分子**だけに絞る。
        // 面マークを描いても、中心が2つ以上あればジアステレオマーの読み分けが要り、
        // 「手前と奥が入れ替わったか」だけを見る練習にならない
        const wedge = mode === 'wedge';
        const inScope = (e) => !wedge || (e.centers === 1 && !e.fromRing && e.geoms === 0);
        const flat = this.pool.filter(e => !e.fromRing && inScope(e));
        const pairs = wedge
            ? this.pairs.filter(([i, j]) => inScope(this.pool[i]) && inScope(this.pool[j]))
            : this.pairs;
        // くさび図モードでライブラリのペアを使わないのは、**答えが偏るから**。
        // 不斉炭素1個の分子どうしで構造式が同じなら関係は鏡像異性体しかありえず、
        // しかも該当する組は D/L の3組だけ。混ぜると「いつも鏡像」で8割当たってしまう
        // （実測: same 23 / enantiomer 97）。回した図だけにすると 42% / 58% に落ち着く
        const canPair = pairs.length > 0 && mode !== 'transform' && !wedge;
        const canTransform = flat.length > 0;
        if (!canPair && !canTransform) return null;
        const useLibraryPair = canPair && (!canTransform || Math.random() < 0.5);
        if (useLibraryPair) {
            let [i, j] = pairs[Math.floor(Math.random() * pairs.length)];
            if (Math.random() < 0.5) [i, j] = [j, i];
            return { targetA: this.pool[i].target, targetB: this.pool[j].target,
                     nameA: this.pool[i].name, nameB: this.pool[j].name, how: 'pair' };
        }
        // 紙面内の回転・鏡映。どれを選ぶと何になるかは判定側に任せる。
        // 標準では **180°回転だけ**（＝同じ分子。フィッシャーの規約を知らなくても
        // 「回しただけ」と分かる）。90°回転や鏡映は規約の理解が要るので発展に回す。
        // 標準にも回転問題を混ぜるのは、ライブラリのペアだけだと
        // 「同じ分子」が正解になる問題が1つも出ないため（ST15 で検出）
        const pick = flat[Math.floor(Math.random() * flat.length)];
        const turns = mode === 'pair' ? 2 : [0, 1, 2, 3][Math.floor(Math.random() * 4)];
        const mirror = mode === 'pair' ? false : Math.random() < 0.35;
        if (turns === 0 && !mirror) return null; // まったく同じ図は出さない
        return { targetA: pick.target, targetB: rotateTargetInPlane(pick.target, turns, mirror),
                 nameA: pick.name, nameB: pick.name, how: 'transform', turns, mirror,
                 // 分子そのものがアキラルか（立体コードと鏡像のコードが一致する）。
                 // 「鏡映したのに同じ」の理由がアキラルとは限らない（回転と鏡映が
                 // 打ち消し合っただけのことがある）ので、ここを取り違えないための材料
                 achiral: pick.stereoCode === pick.mirrorCode };
    }

    /** 出題を指定する（'same' / 'enantiomer' / 'diastereomer'、null で解除） */
    setForced(v) {
        this.forced = ['same', 'enantiomer', 'diastereomer'].includes(v) ? v : null;
    }

    nextQuestion() {
        this.build();
        let q = null;
        // 指定つきのときは試行を増やす。狙った関係が出る確率はまちまちで
        // （例: くさび図モードで「同じ」は 42%）、60回では取りこぼしうる
        const maxTries = this.forced ? 400 : 60;
        for (let tries = 0; tries < maxTries && !q; tries++) {
            const cand = this.makeCandidate();
            if (!cand) continue;
            const molA = this.game.createTargetFromData({ target: cand.targetA });
            const molB = this.game.createTargetFromData({ target: cand.targetB });
            const rel = StereoQuiz.relationOf(molA, molB);
            // 立体が読めなくなった図・つながり方が違う組は出題しない
            if (!rel || rel === 'constitution') continue;
            // 出題の指定（→ readForcedFromUrl の説明）。**生成の狙いではなく
            // 実際に読み直した関係で絞る**ので、回転と鏡映が打ち消し合った図も取り違えない
            if (this.forced && rel !== this.forced) continue;
            q = Object.assign({}, cand, { rel, molA, molB });
        }
        if (!q) {
            const label = { same: '同じ分子', enantiomer: '鏡像異性体', diastereomer: '別の立体異性体' };
            this.resultEl.textContent = this.forced
                ? `指定（${label[this.forced]}）で出題できる組が、いまの出題範囲にありません。`
                : '出題できる立体異性体の組が見つかりませんでした。';
            return;
        }
        // 重ね合わせ表示は問題ごとにリセット（M2.5-A）
        this.clearOverlay();
        this._overlayCmp = undefined;
        if (this.overlayBtn) this.overlayBtn.classList.add('hidden');
        // シス/トランスのある C=C は120°に整えてから描く（P12-8。ユーザー要望）
        const wedge = !!(this.modeEl && this.modeEl.value === 'wedge');
        const legend = document.getElementById('sq-wedge-legend');
        if (legend) legend.classList.toggle('hidden', !wedge);
        // 描いたとおりの分子（120°整形後）を持っておく。重ね合わせの座標・立体は
        // **実際に画面に描かれている図**から読む（整形は幾何を変えないことを保証済み）
        this._dispMolA = renderMoleculeIntoSvg(this.game, 'sq-svg-a', reshapeGeometryForDisplay(this.game, q.targetA), wedge);
        this._dispMolB = renderMoleculeIntoSvg(this.game, 'sq-svg-b', reshapeGeometryForDisplay(this.game, q.targetB), wedge);
        this.current = q;
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        Object.keys(this.buttons).forEach(k => { this.buttons[k].disabled = false; });
        this.updateScore();
    }

    answer(said) {
        if (!this.current || this.buttons.same.disabled) return;
        Object.keys(this.buttons).forEach(k => { this.buttons[k].disabled = true; });
        this.score.asked++;
        const c = this.current;
        const correct = said === c.rel;
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'stereo', correct: correct });
        const label = { same: '同じ分子', enantiomer: '鏡像異性体', diastereomer: '別の立体異性体（ジアステレオマー）' };
        const head = correct ? '⭕ 正解！' : `❌ 残念…正解は「${label[c.rel]}」。`;
        this.resultEl.textContent = head + ' ' + this.explain(c);
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        // 答え合わせのあとで「重ねて確かめる」を出す（M2.5-A。答えが透けるので解答前は出さない）
        if (this.overlayBtn && this.overlayCompare()) this.overlayBtn.classList.remove('hidden');
        this.updateScore();
    }

    // ===== 重ね合わせビュー（M2.5-A） =====
    //
    // 「重ね合わせられるか」という立体異性の定義そのものを操作で見せる。
    // 図Bをシャドウ化して図Aへ**平行移動**し（対応づけ後に重心を合わせる）、
    // 不斉炭素・C=C ごとに一致(✓)/食い違い(✗)の印を付ける。
    // 原子の対応は座標ではなく**正準ラベリング（グラフの同型写像）**で決め、
    // 全対応のうち一致数が最大のものを使う（chemistry.js の stereoIsomorphismCompare）。
    // だから「最もよく重なる対応でも食い違いが残る＝重ね合わせられない」と正確に言える。

    /** 表示中の2つの図の立体比較（結果は問題ごとにキャッシュ）。できなければ null */
    overlayCompare() {
        if (!this._dispMolA || !this._dispMolB) return null;
        if (this._overlayCmp === undefined) {
            const a = readStereoOf(this._dispMolA);
            const b = readStereoOf(this._dispMolB);
            this._overlayCmp = (a && b && typeof stereoIsomorphismCompare === 'function')
                ? stereoIsomorphismCompare(this._dispMolA, a.stereo, this._dispMolB, b.stereo)
                : null;
        }
        return this._overlayCmp;
    }

    toggleOverlay() {
        if (this._overlayOn) this.clearOverlay();
        else this.showOverlay();
    }

    showOverlay() {
        const cmp = this.overlayCompare();
        const svgA = document.getElementById('sq-svg-a');
        const svgB = document.getElementById('sq-svg-b');
        if (!cmp || !svgA || !svgB) {
            if (this.overlayNoteEl) this.overlayNoteEl.textContent = 'この組では重ね合わせ表示ができません。';
            return;
        }
        const molA = this._dispMolA, molB = this._dispMolB;
        const heavyA = molA.atoms.filter(a => a.element !== 'H');
        const heavyB = molB.atoms.filter(a => a.element !== 'H');
        // 平行移動量: 対応づけた原子どうしの重心を合わせる（map は重原子の全単射なので
        // 「重原子全体の重心」と同じ。回転や拡大縮小はしない＝平行移動だけで重ねる）
        const cen = list => list.reduce((s, a) => [s[0] + a.x, s[1] + a.y], [0, 0]).map(v => v / list.length);
        const [cxA, cyA] = cen(heavyA);
        const [cxB, cyB] = cen(heavyB);
        const dx = Math.round(cxA - cxB), dy = Math.round(cyA - cyB);

        const NS = 'http://www.w3.org/2000/svg';
        // 図Bのゴースト（重原子の骨格だけ。水素・くさびは省いて「影」であることを分かりやすく）
        const ghost = document.createElementNS(NS, 'g');
        ghost.setAttribute('class', 'sq-overlay-ghost');
        ghost.setAttribute('style',
            'opacity:0; transform:translate(120px,0); transition:opacity .5s ease, transform .5s ease;' +
            ' filter:drop-shadow(0 0 5px rgba(0,242,254,0.7));');
        molB.bonds.forEach(b => {
            const a1 = molB.atoms.find(a => a.id === b.atomId1);
            const a2 = molB.atoms.find(a => a.id === b.atomId2);
            if (!a1 || !a2) return;
            this.game.renderTargetBond(a1.x + dx, a1.y + dy, a2.x + dx, a2.y + dy, b.type, false, ghost);
        });
        heavyB.forEach(a => this.game.renderTargetAtom(a.element, a.x + dx, a.y + dy, ghost));
        svgA.appendChild(ghost);

        // 一致/不一致の印（図Aの座標に描く。ゴーストが滑り込んだあとに現れる）
        const marks = document.createElementNS(NS, 'g');
        marks.setAttribute('class', 'sq-overlay-marks');
        marks.setAttribute('style', 'opacity:0; transition:opacity .4s ease .45s;');
        const addMark = (x, y, match) => {
            const color = match ? 'rgba(46,213,115,0.95)' : 'rgba(255,71,87,0.95)';
            const ring = document.createElementNS(NS, 'circle');
            ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', 17);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', color);
            ring.setAttribute('stroke-width', '2.5');
            if (!match) ring.setAttribute('stroke-dasharray', '5 3');
            marks.appendChild(ring);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x + 14); t.setAttribute('y', y - 14);
            t.setAttribute('fill', color);
            t.setAttribute('font-size', '15');
            t.setAttribute('font-weight', 'bold');
            t.textContent = match ? '✓' : '✗';
            marks.appendChild(t);
        };
        const atomOf = id => molA.atoms.find(a => a.id === id);
        cmp.centers.forEach(cn => { const a = atomOf(cn.a); if (a) addMark(a.x, a.y, cn.match); });
        cmp.geos.forEach(gs => {
            const a1 = atomOf(gs.a[0]), a2 = atomOf(gs.a[1]);
            if (a1 && a2) addMark((a1.x + a2.x) / 2, (a1.y + a2.y) / 2, gs.match);
        });
        svgA.appendChild(marks);

        // 図Aの枠を、ゴーストも収まる範囲へ広げる（元の viewBox は解除時に戻す）
        this._overlayViewBox = svgA.getAttribute('viewBox');
        const vb = (this._overlayViewBox || '0 0 320 250').split(/\s+/).map(Number);
        let minX = vb[0], minY = vb[1], maxX = vb[0] + vb[2], maxY = vb[1] + vb[3];
        heavyB.forEach(a => {
            minX = Math.min(minX, a.x + dx - 30); maxX = Math.max(maxX, a.x + dx + 30);
            minY = Math.min(minY, a.y + dy - 30); maxY = Math.max(maxY, a.y + dy + 30);
        });
        svgA.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);

        // 滑り込みアニメーション開始（2段 rAF で初期スタイルを確定させてから遷移）
        requestAnimationFrame(() => requestAnimationFrame(() => {
            ghost.style.opacity = '0.55';
            ghost.style.transform = 'translate(0,0)';
            marks.style.opacity = '1';
        }));
        svgB.style.opacity = '0.25';

        // 言葉でも結果を示す（数は最良の対応での実測値）
        const badC = cmp.centers.filter(x => !x.match).length;
        const badG = cmp.geos.filter(x => !x.match).length;
        const parts = [];
        if (cmp.centers.length) {
            parts.push(badC === 0
                ? `不斉炭素原子 ${cmp.centers.length} 個はすべて一致（緑の◯）`
                : `不斉炭素原子 ${cmp.centers.length} 個中 ${badC} 個で立体が食い違い（赤の破線◯）`);
        }
        if (cmp.geos.length) {
            parts.push(badG === 0
                ? 'C=C のシス/トランスは一致（緑の◯）'
                : `C=C ${cmp.geos.length} 本中 ${badG} 本でシス/トランスが食い違い（赤の破線◯）`);
        }
        const verdict = badC + badG === 0
            ? '→ すべて重なる＝同じ分子です。'
            : '→ どの対応のさせ方でもこの食い違いは消せない＝重ね合わせられない別の分子です。';
        if (this.overlayNoteEl) {
            this.overlayNoteEl.textContent =
                '図Bを影にして図Aへ平行移動しました。原子の対応は、見た目の位置ではなく' +
                '「つながり方が最もよく合う対応」で決めています。\n' +
                parts.join('、') + ' ' + verdict;
        }
        if (this.overlayBtn) this.overlayBtn.textContent = '↩ 重ね合わせを解除';
        this._overlayOn = true;
    }

    clearOverlay() {
        this._overlayOn = false;
        const svgA = document.getElementById('sq-svg-a');
        const svgB = document.getElementById('sq-svg-b');
        if (svgA) svgA.querySelectorAll('.sq-overlay-ghost, .sq-overlay-marks').forEach(el => el.remove());
        if (svgA && this._overlayViewBox) svgA.setAttribute('viewBox', this._overlayViewBox);
        this._overlayViewBox = null;
        if (svgB) svgB.style.opacity = '';
        if (this.overlayNoteEl) this.overlayNoteEl.textContent = '';
        if (this.overlayBtn) this.overlayBtn.textContent = '🫟 重ねて確かめる（図Bを図Aへ平行移動）';
    }

    /**
     * ジアステレオマーの理由を、その分子に即して言い分ける（P12-8。ユーザー指摘）。
     * 「不斉炭素の違い」と「C=C のシス/トランス」は高校では別の名前で扱う話題なので、
     * 両論併記にせず、実際にどちらなのかを見て言い切る。
     */
    diastereomerWhy(c) {
        const a = readStereoOf(c.molA);
        const head = '立体異性体ですが鏡像ではありません（ジアステレオマー）。';
        if (!a) return head;
        if (a.centers === 0 && a.geoms > 0) {
            return 'C=C のまわりの並びが違う「シス・トランス異性体（幾何異性体）」です。' +
                '二重結合は回転できないので、同じ側（シス）に付いているか反対側（トランス）に' +
                '付いているかで別の分子になります。鏡像の関係ではないので、' +
                'ジアステレオマーに分類されます。';
        }
        if (a.centers > 0 && a.geoms === 0) {
            return head + `不斉炭素原子が ${a.centers} 個あり、そのうち一部だけが逆になっています` +
                '（すべて逆なら鏡像異性体になります）。';
        }
        return head + '不斉炭素原子の立体か、C=C のシス/トランスのどちらかが部分的に違います。';
    }

    explain(c) {
        const why = {
            same: '重ね合わせられる（回転だけで一致する）ので同じ分子です。',
            enantiomer: '鏡に映すと重なるが、回転だけでは重ならない関係です（エナンチオマー）。' +
                'すべての不斉炭素原子で立体が逆になっています。',
            diastereomer: this.diastereomerWhy(c)
        }[c.rel];
        let how;
        if (c.how === 'pair') {
            how = `左は「${c.nameA}」、右は「${c.nameB}」。`;
        } else {
            const deg = c.turns * 90;
            how = `どちらも「${c.nameA}」を描いた図で、右は左を紙面内で ${deg}° 回した` +
                (c.mirror ? '（さらに左右を反転した）' : '') + 'ものです。';
            if (!c.mirror && c.turns % 2 === 1 && c.rel === 'enantiomer') {
                how += '\n※ フィッシャー投影は「紙面内で90°回すと鏡像になる」性質があります' +
                    '（縦が紙面の奥・横が手前という約束なので、90°回すと奥と手前が入れ替わる）。' +
                    '180°なら同じ分子のままです。';
            }
            if (c.mirror && c.rel === 'same') {
                // 「鏡映したのに同じ」の理由は2通りある。取り違えると嘘になる
                how += c.achiral
                    ? '\n※ この分子は鏡像が自分自身と一致します（不斉炭素原子が無い、またはメソ体で分子内に対称面がある）。' +
                      'つまり鏡像異性体が存在しません。'
                    : '\n※ この分子には鏡像異性体があります。にもかかわらず同じ分子になったのは、' +
                      '左右の反転と紙面内の回転が打ち消し合ったからです' +
                      '（フィッシャー投影では90°回転が鏡像に相当するので、反転と組み合わさると元に戻ることがあります）。';
            }
        }
        return how + '\n' + why;
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// ===== フィッシャー投影の操作学習（M2.5-B） =====
//
// 2つの図を並べ、右の図だけを「分子を変えない図上の変形」で操作して見比べる練習モード。
// 許す操作は**偶置換**になるものだけ（DEVELOPMENT.md M2.5-B。2026-07-27 ユーザー指定）:
//   ・180°回転（上下と左右の同時入れ替え＝転置2回＝偶）
//   ・90°回転＋（回転後の）左右入れ替え（4巡回＋転置＝偶）。90°単独は奇置換＝鏡像に
//     なってしまうので、そういうボタンは**UIに出さない**
//   ・1つのC原子で軸の枝を固定し、残り3つの枝を巡回（3巡回＝偶）
// どの操作も、適用した図から立体を**読み直して** canonicalCode / canonicalStereoCode が
// 変わっていないことを確かめてから確定する（生成側の意図を信用しない、の方針どおり）。
// 変わってしまう場合（枝の中に別の不斉炭素がある巡回など）は適用しない。

/**
 * 変形候補を作って検証し、分子が変わっていなければ新しい target を返す共通部。
 * 棄却条件: 立体が読めなくなる／正準コードか立体コードが変わる／原子が重なる。
 */
function applyVerifiedFischerOp(game, target, makeCandidate) {
    const before = readStereoOf(game.createTargetFromData({ target }));
    if (!before) return null;
    const cand = makeCandidate();
    if (!cand) return null;
    // 原子どうしが重なる図は読み間違いのもとなので不可（グリッド42pxの半分を下限とする）
    for (let i = 0; i < cand.atoms.length; i++) {
        for (let j = i + 1; j < cand.atoms.length; j++) {
            if (Math.hypot(cand.atoms[i].x - cand.atoms[j].x,
                           cand.atoms[i].y - cand.atoms[j].y) < 21) return null;
        }
    }
    const after = readStereoOf(game.createTargetFromData({ target: cand }));
    if (!after) return null;
    if (after.code !== before.code || after.stereoCode !== before.stereoCode) return null;
    if (after.centers !== before.centers || after.geoms !== before.geoms) return null;
    return cand;
}

// 180°回転（偶置換なので分子は変わらない）
function fischerOpRotate180(game, target) {
    return applyVerifiedFischerOp(game, target, () => rotateTargetInPlane(target, 2, false));
}

/**
 * 90°回転＋（回転後の）左右入れ替え。90°単独は4巡回＝奇置換で鏡像になってしまうので、
 * 転置を1つ重ねて偶に戻す。「90°回すと縦横＝奥/手前の意味が入れ替わるから、同じ分子を
 * 保つには2つを入れ替える必要がある」というフィッシャーの規約そのものを操作で見せる。
 * 実装は rotateTargetInPlane の mirrorX（回転後に x を反転＝左右の枝の入れ替え）。
 */
function fischerOpRotate90(game, target, dir) {
    const turns = dir === 'ccw' ? 3 : 1;
    return applyVerifiedFischerOp(game, target, () => rotateTargetInPlane(target, turns, true));
}

/**
 * 1つの不斉炭素で「軸にする枝」(fixedSlot) を固定し、残り3つの枝を巡回させる
 * （3巡回＝偶置換。くさび図の cycleOthers を2Dの作図データの上で行う版）。
 * centerIndex は target.atoms のインデックス。dir='cw' は残り3スロットを時計回りに送る。
 * 枝（サブツリー）は中心を軸に±90°/180°の剛体回転で動かす。暗黙のHのスロットは
 * 動かすものが無いのでそのまま。環・枝の共有・他の中心が壊れる場合は null。
 */
function fischerOpCycle(game, target, centerIndex, fixedSlot, dir) {
    const AXES = [
        { key: 'up', vx: 0, vy: -1 }, { key: 'right', vx: 1, vy: 0 },
        { key: 'down', vx: 0, vy: 1 }, { key: 'left', vx: -1, vy: 0 }
    ];
    if (!AXES.some(ax => ax.key === fixedSlot)) return null;
    return applyVerifiedFischerOp(game, target, () => {
        const center = target.atoms[centerIndex];
        if (!center) return null;
        const adj = target.atoms.map(() => []);
        target.bonds.forEach(b => {
            adj[b.atom1Index].push(b.atom2Index);
            adj[b.atom2Index].push(b.atom1Index);
        });
        // 隣接をスロット（±25°。判定と同じ許容）へ分類
        const COS_TOL = Math.cos(25 * Math.PI / 180);
        const slotOf = {};
        for (const ni of adj[centerIndex]) {
            const a = target.atoms[ni];
            const dx = a.x - center.x, dy = a.y - center.y;
            const len = Math.hypot(dx, dy) || 1;
            const hit = AXES.find(ax => (dx * ax.vx + dy * ax.vy) / len >= COS_TOL);
            if (!hit || slotOf[hit.key] !== undefined) return null; // 軸外れ・スロット衝突
            slotOf[hit.key] = ni;
        }
        // 巡回する3スロット（up→right→down→left の時計回りの並びから軸を除く）
        const ring = ['up', 'right', 'down', 'left'].filter(k => k !== fixedSlot);
        const step = dir === 'ccw' ? 2 : 1;
        // スロット from の枝を to へ動かす剛体回転（軸ベクトルどうしなので cos/sin は 0/±1）
        const rotTo = (from, to, p) => {
            const A = AXES.find(ax => ax.key === from);
            const B = AXES.find(ax => ax.key === to);
            const cos = A.vx * B.vx + A.vy * B.vy;
            const sin = A.vx * B.vy - A.vy * B.vx;
            const dx = p.x - center.x, dy = p.y - center.y;
            return { x: Math.round(center.x + dx * cos - dy * sin),
                     y: Math.round(center.y + dx * sin + dy * cos) };
        };
        const atoms = target.atoms.map(a => Object.assign({}, a));
        const used = new Set();
        for (let i = 0; i < 3; i++) {
            const from = ring[i], to = ring[(i + step) % 3];
            const rootIdx = slotOf[from];
            if (rootIdx === undefined) continue; // 暗黙のHのスロット: 動かすものが無い
            // 枝のサブツリー（中心を通らずに届く原子）を集めて回す
            const seen = new Set([centerIndex, rootIdx]);
            const stack = [rootIdx], branch = [rootIdx];
            while (stack.length) {
                adj[stack.pop()].forEach(n => {
                    if (!seen.has(n)) { seen.add(n); branch.push(n); stack.push(n); }
                });
            }
            for (const idx of branch) {
                if (used.has(idx)) return null; // 枝が共有されている＝環を含む
                used.add(idx);
                const p = rotTo(from, to, target.atoms[idx]);
                atoms[idx].x = p.x;
                atoms[idx].y = p.y;
            }
        }
        return { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
    });
}

/**
 * 1つの不斉炭素で、向かい合う2スロットを入れ替える（転置1回＝**奇置換**）。
 * その中心の立体が反転する ＝**分子が変わる操作**。
 *
 *   axis='vertical'   … **縦軸の鏡**。左右が入れ替わる（十字の模型では左辺・右辺の鏡）
 *   axis='horizontal' … **横軸の鏡**。上下が入れ替わる（同じく上辺・下辺の鏡）
 *
 * 鏡は自分自身が逆操作（2回で戻る）。**辺は4つあるが結果は2通りしかない**
 * ＝ 鏡像は1つしかない、というのがこの見せ方の芯（C-5c）。
 * 練習モード（M2.5-B。分子を変えない操作だけ）には出さず、
 * タイムアタック（M2.5-C。お題の立体異性体を「作る」のが目的）でだけ使う。
 * つながり方（canonicalCode）と中心の数は変わらないことを検証してから確定する。
 */
function fischerOpMirror(game, target, centerIndex, axis) {
    const AXES = [
        { key: 'up', vx: 0, vy: -1 }, { key: 'right', vx: 1, vy: 0 },
        { key: 'down', vx: 0, vy: 1 }, { key: 'left', vx: -1, vy: 0 }
    ];
    const before = readStereoOf(game.createTargetFromData({ target }));
    if (!before) return null;
    const trySwap = (keyA, keyB) => {
        const center = target.atoms[centerIndex];
        if (!center) return null;
        const adj = target.atoms.map(() => []);
        target.bonds.forEach(b => {
            adj[b.atom1Index].push(b.atom2Index);
            adj[b.atom2Index].push(b.atom1Index);
        });
        const COS_TOL = Math.cos(25 * Math.PI / 180);
        const slotOf = {};
        for (const ni of adj[centerIndex]) {
            const a = target.atoms[ni];
            const dx = a.x - center.x, dy = a.y - center.y;
            const len = Math.hypot(dx, dy) || 1;
            const hit = AXES.find(ax => (dx * ax.vx + dy * ax.vy) / len >= COS_TOL);
            if (!hit || slotOf[hit.key] !== undefined) return null;
            slotOf[hit.key] = ni;
        }
        // 入れ替え＝それぞれの枝サブツリーを中心まわりに180°回転（暗黙Hの側は動かすものが無い）
        const atoms = target.atoms.map(a => Object.assign({}, a));
        const used = new Set();
        for (const key of [keyA, keyB]) {
            const rootIdx = slotOf[key];
            if (rootIdx === undefined) continue;
            const seen = new Set([centerIndex, rootIdx]);
            const stack = [rootIdx], branch = [rootIdx];
            while (stack.length) {
                adj[stack.pop()].forEach(n => {
                    if (!seen.has(n)) { seen.add(n); branch.push(n); stack.push(n); }
                });
            }
            for (const idx of branch) {
                if (used.has(idx)) return null; // 枝の共有＝環を含む
                used.add(idx);
                atoms[idx].x = Math.round(2 * center.x - target.atoms[idx].x);
                atoms[idx].y = Math.round(2 * center.y - target.atoms[idx].y);
            }
        }
        const cand = { atoms, bonds: target.bonds.map(b => Object.assign({}, b)) };
        for (let i = 0; i < cand.atoms.length; i++) {
            for (let j = i + 1; j < cand.atoms.length; j++) {
                if (Math.hypot(cand.atoms[i].x - cand.atoms[j].x,
                               cand.atoms[i].y - cand.atoms[j].y) < 21) return null;
            }
        }
        const after = readStereoOf(game.createTargetFromData({ target: cand }));
        if (!after) return null;
        // つながり方は不変。立体コードは変わってよい（それがこの操作の目的）
        if (after.code !== before.code) return null;
        if (after.centers !== before.centers || after.geoms !== before.geoms) return null;
        return cand;
    };
    return axis === 'horizontal' ? trySwap('up', 'down') : trySwap('left', 'right');
}

/**
 * 中心の立体を反転させる（軸は問わない）。まず縦軸の鏡を試し、枝が重なるなどで無理なら
 * 横軸の鏡を試す。どちらも転置1回なので、その中心の反転として同じ意味になる。
 * 練習モードと、軸を指定しない呼び出し（既存の互換）のために残す。
 */
function fischerOpSwap(game, target, centerIndex) {
    return fischerOpMirror(game, target, centerIndex, 'vertical') ||
           fischerOpMirror(game, target, centerIndex, 'horizontal');
}

class FischerPractice {
    /**
     * opts.prefix で要素IDの接頭辞を切り替えられる（タイムアタック M2.5-C が 'ta' で継承する）。
     * 参照する要素: `${p}-task/-status/-centers/-axis/-moves/-svg-a/-svg-b` と `btn-${p}-…`
     */
    constructor(game, opts) {
        const o = Object.assign(
            { prefix: 'fp', modalId: 'fischer-practice-modal', openBtnId: 'btn-fischer-practice' }, opts);
        this.game = game;
        this.p = o.prefix;
        this.pool = null;
        this.current = null; // { entry, targetA, targetB, base, how }
        this.moves = 0;
        this.finished = false; // タイムアタックで完成後の操作を止めるため（練習では常に false）
        this.selCenter = null; // 選択中の中心（target.atoms のインデックス）
        this.selAxis = 'up';
        this.modal = document.getElementById(o.modalId);
        if (!this.modal) return;
        const p = this.p;
        this.taskEl = document.getElementById(`${p}-task`);
        this.statusEl = document.getElementById(`${p}-status`);
        this.centersEl = document.getElementById(`${p}-centers`);
        this.axisEl = document.getElementById(`${p}-axis`);
        this.movesEl = document.getElementById(`${p}-moves`);
        const btn = document.getElementById(o.openBtnId);
        if (btn) btn.addEventListener('click', () => this.open());
        // 置いていないボタンは黙って飛ばす。タイムアタック（'ta'）は操作を
        // 「回転CW・回転ACW・鏡像の入れ替え」の3つに絞ってあり、180°回転と巡回を持たない
        // （2026-08-01 ユーザー指定。練習モード 'fp' は全部そろえたまま）
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on(`btn-${p}-close`, () => this.modal.classList.add('hidden'));
        on(`btn-${p}-next`, () => this.newQuestion());
        on(`btn-${p}-reset`, () => this.resetFigure());
        on(`btn-${p}-rot180`, () => this.applyOp('rot180'));
        on(`btn-${p}-rot90cw`, () => this.applyOp('rot90cw'));
        on(`btn-${p}-rot90ccw`, () => this.applyOp('rot90ccw'));
        on(`btn-${p}-cycle-cw`, () => this.applyCycle('cw'));
        on(`btn-${p}-cycle-ccw`, () => this.applyCycle('ccw'));
    }

    open() {
        this.build();
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    build() {
        if (this.pool) return;
        // フィッシャー投影として立体が読める鎖状分子だけ。環（ハース）は投影の規約が別で、
        // C=C の幾何も別の話題なので混ぜない
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info && !info.fromRing && info.geoms === 0 && info.centers >= 1) {
                this.pool.push(Object.assign({}, e, info));
            }
        });
    }

    // 図の「見た目」の同一性（平行移動だけ無視）。ぴったり戻せたかの判定に使う
    static drawingKey(target) {
        const cx = target.atoms.reduce((s, a) => s + a.x, 0) / target.atoms.length;
        const cy = target.atoms.reduce((s, a) => s + a.y, 0) / target.atoms.length;
        const pt = a => `${Math.round(a.x - cx)},${Math.round(a.y - cy)}`;
        const atoms = target.atoms.map(a => `${a.element}:${pt(a)}`).sort();
        const bonds = target.bonds
            .map(b => [pt(target.atoms[b.atom1Index]), pt(target.atoms[b.atom2Index])].sort().join('~') + ':' + b.type)
            .sort();
        return atoms.join('|') + '#' + bonds.join('|');
    }

    // フィッシャーとして読める不斉炭素の target インデックス（mol.atoms[i] ⇔ target.atoms[i]）
    readableCenters(target) {
        const mol = this.game.createTargetFromData({ target });
        return Object.keys(readAtomParityFromFischer(mol))
            .map(id => mol.atoms.findIndex(a => a.id === id))
            .filter(i => i >= 0)
            .sort((a, b) => a - b);
    }

    // いま右に描かれている分子の、左との関係（毎回、図から読み直して判定する）
    currentRelation() {
        if (!this.current) return null;
        return StereoQuiz.relationOf(
            this.game.createTargetFromData({ target: this.current.targetA }),
            this.game.createTargetFromData({ target: this.current.targetB }));
    }

    // お題のかき混ぜ: 許された操作だけを重ねる（＝必ず同じ分子のまま）
    scramble(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const ops = [
                () => fischerOpRotate180(this.game, t),
                () => fischerOpRotate90(this.game, t, 'cw'),
                () => fischerOpRotate90(this.game, t, 'ccw')
            ];
            const centers = this.readableCenters(t);
            if (centers.length) {
                const ci = centers[Math.floor(Math.random() * centers.length)];
                const slot = ['up', 'right', 'down', 'left'][Math.floor(Math.random() * 4)];
                ops.push(() => fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw'));
            }
            const r = ops[Math.floor(Math.random() * ops.length)]();
            if (r) t = r;
        }
        return t;
    }

    newQuestion() {
        this.build();
        if (!this.pool.length) {
            if (this.statusEl) this.statusEl.textContent = '出題できる分子が見つかりませんでした。';
            return;
        }
        let q = null;
        for (let tries = 0; tries < 40 && !q; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            // 鏡像のお題はキラルな分子だけ（アキラルだと鏡像＝同じ分子で、ねらいがぼける）
            const mirror = e.stereoCode !== e.mirrorCode && Math.random() < 0.4;
            let tB = mirror
                ? rotateTargetInPlane(e.target, 0, true)
                : this.scramble(e.target, 1 + Math.floor(Math.random() * 3));
            if (!mirror && FischerPractice.drawingKey(tB) === FischerPractice.drawingKey(e.target)) continue;
            // 図から読み直した関係が想定どおりであることを確認してから出題する
            const rel = StereoQuiz.relationOf(
                this.game.createTargetFromData({ target: e.target }),
                this.game.createTargetFromData({ target: tB }));
            if (mirror ? rel !== 'enantiomer' : rel !== 'same') continue;
            q = { entry: e, targetA: e.target, targetB: tB, base: tB, how: mirror ? 'mirror' : 'scramble' };
        }
        if (!q) {
            if (this.statusEl) this.statusEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.moves = 0;
        this.finished = false;
        this.selCenter = null;
        this.selAxis = 'up';
        if (this.taskEl) {
            this.taskEl.textContent = q.how === 'mirror'
                ? `左は「${q.entry.name}」、右はそれを鏡に映した図です。分子を変えない操作だけで、右を左と同じ図にできるでしょうか？`
                : `左は「${q.entry.name}」、右は同じ分子を（分子を変えない操作で）かき混ぜた図です。操作で左とぴったり同じ図に戻してみましょう。`;
        }
        renderMoleculeIntoSvg(this.game, `${this.p}-svg-a`, q.targetA, false);
        this.refresh(true);
    }

    resetFigure() {
        if (!this.current) return;
        this.current.targetB = this.current.base;
        this.moves = 0;
        this.refresh(true);
    }

    applyOp(kind) {
        if (!this.current || this.finished) return;
        const t = this.current.targetB;
        const r = kind === 'rot180' ? fischerOpRotate180(this.game, t)
            : kind === 'rot90cw' ? fischerOpRotate90(this.game, t, 'cw')
            : fischerOpRotate90(this.game, t, 'ccw');
        if (!r) {
            if (this.statusEl) this.statusEl.textContent = 'この操作はこの図では行えません。';
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    applyCycle(dir) {
        if (!this.current || this.finished) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に回す中心（C）を選んでください。';
            return;
        }
        const r = fischerOpCycle(this.game, this.current.targetB, this.selCenter, this.selAxis, dir);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    'この回し方はこの図では行えません（枝どうしが重なるか、枝の中の別の不斉炭素原子の読みが壊れるため）。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /** 右の図・中心バッジ・軸ボタン・状態表示をまとめて更新する */
    refresh(resetStatus) {
        if (!this.current) return;
        const molB = renderMoleculeIntoSvg(this.game, `${this.p}-svg-b`, this.current.targetB, false);
        this.molB = molB; // 十字の模型（タイムアタック）が置換基のラベルを引くのに使う
        const centers = this.readableCenters(this.current.targetB);
        if (centers.length && (this.selCenter === null || !centers.includes(this.selCenter))) {
            this.selCenter = centers[0];
        }
        this.renderBadges(centers);
        this.renderCenterButtons(centers);
        this.renderAxisButtons(molB);
        this.updateStatus(resetStatus);
    }

    // 右の図の不斉炭素に①②…のバッジを重ねる（クリックで中心を選べる）
    renderBadges(centers) {
        const svg = document.getElementById(`${this.p}-svg-b`);
        if (!svg) return;
        const group = svg.querySelector('.fp-badges');
        if (!group) return;
        group.innerHTML = '';
        const NS = 'http://www.w3.org/2000/svg';
        centers.forEach((ci, k) => {
            const a = this.current.targetB.atoms[ci];
            const sel = ci === this.selCenter;
            const ring = document.createElementNS(NS, 'circle');
            ring.setAttribute('cx', a.x); ring.setAttribute('cy', a.y); ring.setAttribute('r', 15);
            ring.setAttribute('fill', 'none');
            ring.setAttribute('stroke', sel ? 'rgba(224,176,255,0.95)' : 'rgba(224,176,255,0.35)');
            ring.setAttribute('stroke-width', sel ? '2.5' : '1.5');
            ring.setAttribute('style', 'cursor:pointer;');
            ring.addEventListener('click', () => { this.selCenter = ci; this.refresh(false); });
            group.appendChild(ring);
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', a.x + 13); t.setAttribute('y', a.y - 13);
            t.setAttribute('fill', 'rgba(224,176,255,0.9)');
            t.setAttribute('font-size', '13');
            t.textContent = '①②③④⑤⑥⑦⑧⑨'[k] || String(k + 1);
            group.appendChild(t);
        });
    }

    renderCenterButtons(centers) {
        if (!this.centersEl) return;
        this.centersEl.innerHTML = '';
        if (centers.length <= 1) return; // 1つなら自動選択で足りる
        const label = document.createElement('span');
        label.style.color = 'var(--text-secondary)';
        label.textContent = '回す中心:';
        this.centersEl.appendChild(label);
        centers.forEach((ci, k) => {
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.padding = '4px 10px';
            b.textContent = '①②③④⑤⑥⑦⑧⑨'[k] || String(k + 1);
            if (ci === this.selCenter) b.style.borderColor = 'var(--neon-purple)';
            b.addEventListener('click', () => { this.selCenter = ci; this.refresh(false); });
            this.centersEl.appendChild(b);
        });
    }

    // 軸（固定する枝）の選択ボタン。中身のラベル付きで、回せない軸は無効化して見せる
    renderAxisButtons(molB) {
        if (!this.axisEl) return;
        this.axisEl.innerHTML = '';
        if (this.selCenter === null || !molB) return;
        const centerAtom = molB.atoms[this.selCenter];
        const slots = centerAtom ? fischerSlots(molB, centerAtom.id) : null;
        if (!slots) return;
        const label = document.createElement('span');
        label.style.color = 'var(--text-secondary)';
        label.textContent = '軸にする枝（固定）:';
        this.axisEl.appendChild(label);
        const JA = { up: '上', right: '右', down: '下', left: '左' };
        ['up', 'right', 'down', 'left'].forEach(k => {
            const ref = slots[k];
            const name = ref === 'H' ? 'H' : substituentLabel(molB, ref, centerAtom.id);
            const b = document.createElement('button');
            b.className = 'view-btn';
            b.style.padding = '4px 10px';
            b.textContent = `${JA[k]}（${name}）`;
            // どちら向きにも回せない軸は無効化（押しても分子が変わる操作は出さない、の方針）
            const ok = fischerOpCycle(this.game, this.current.targetB, this.selCenter, k, 'cw') ||
                       fischerOpCycle(this.game, this.current.targetB, this.selCenter, k, 'ccw');
            b.disabled = !ok;
            if (k === this.selAxis) b.style.borderColor = 'var(--neon-purple)';
            b.addEventListener('click', () => { this.selAxis = k; this.refresh(false); });
            this.axisEl.appendChild(b);
        });
    }

    updateStatus(resetStatus) {
        const rel = this.currentRelation();
        const matched = FischerPractice.drawingKey(this.current.targetA) ===
                        FischerPractice.drawingKey(this.current.targetB);
        const relText = {
            same: '左と同じ分子です（操作しても分子は変わっていません）',
            enantiomer: '左の鏡像異性体です。分子を変えない操作だけでは、左と同じ図には決してなりません',
            diastereomer: '左とは別の立体異性体です'
        }[rel] || '判定できません';
        let text = `いま右に描かれている分子: ${relText}。`;
        if (matched) {
            text = `🎯 ぴったり同じ図になりました！（手数 ${this.moves}）\n` +
                   '回転と巡回（分子を変えない操作）だけで一致した＝2つは同じ分子だと、図の上で確かめられました。';
        } else if (!resetStatus) {
            text += '\n図は変わりましたが、読み直しても分子は変わっていません（偶置換だけを許しているため）。';
        }
        if (this.statusEl) {
            this.statusEl.textContent = text;
            this.statusEl.className = matched ? 'result-message success' : '';
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
    }
}

// ===== 十字の模型（検品レビュー C-5c の操作面） =====
//
// 4つのスロット（上・右・下・左）を十字に置き、**各スロットの外側に回転ボタン**
// （押したスロットが「固定する枝」）、**外枠の4辺に鏡ボタン**を並べる共通部品。
// 立体タイムアタック（分子）と記号パズル（模式模型・ORDER 第2段）の**両方が
// 同じ操作面を使う**——「模式モードで規則を覚え、分子モードで実物に当てる」を
// 同じ手つきで通すため。ここが分かれると2つのモードが別の遊びになってしまう。
//
// DOM の前提: SVG `#${prefix}-cross`（中に `g.cross-labels`）と
//   `#btn-${prefix}-rot-<up|right|down|left>-<cw|ccw>`
//   `#btn-${prefix}-mirror-<top|bottom|left|right>`
// 中身は呼び出し側の関数が決める:
//   labels()  … { up, right, down, left, center } の表示（文字列か {text,color}）。
//               null なら空の十字
//   canCycle(slot, dir) / canMirror(axis) … 押せるか（押せない操作は出さない、の方針）
//   onCycle(slot, dir)  / onMirror(axis)  … 押されたときの処理
class CrossModel {
    constructor(prefix, handlers) {
        this.p = prefix;
        this.h = handlers;
        CrossModel.SLOTS.forEach(slot => ['ccw', 'cw'].forEach(dir => {
            const el = document.getElementById(`btn-${prefix}-rot-${slot}-${dir}`);
            if (el) el.addEventListener('click', () => this.h.onCycle(slot, dir));
        }));
        CrossModel.EDGES.forEach(e => {
            const el = document.getElementById(`btn-${prefix}-mirror-${e.edge}`);
            if (!el) return;
            el.addEventListener('click', () => {
                this.flash(e.axis); // 対になる辺が同じ操作だと分かるよう、両方を光らせる
                this.h.onMirror(e.axis);
            });
        });
    }

    /**
     * 十字の4スロット＋中心に文字を並べる（操作ボタンを持たない静止画にも使う）。
     * labels の各値は文字列か { text, color }。null なら「—」だけの空の十字。
     * 座標は viewBox "0 0 300 200" 前提（十字の線・中心の丸は SVG 側に直接書いてある）。
     */
    static paint(svg, labels) {
        const group = svg && svg.querySelector('.cross-labels');
        if (!group) return;
        group.innerHTML = '';
        const NS = 'http://www.w3.org/2000/svg';
        const put = (x, y, anchor, value, cls) => {
            const t = document.createElementNS(NS, 'text');
            t.setAttribute('x', x); t.setAttribute('y', y);
            t.setAttribute('text-anchor', anchor);
            t.setAttribute('class', cls);
            if (value && value.color) t.setAttribute('fill', value.color);
            t.textContent = value && value.text !== undefined ? value.text : (value || '');
            group.appendChild(t);
        };
        if (!labels) { put(150, 106, 'middle', '—', 'cross-center'); return; }
        put(150, 30, 'middle', labels.up, 'cross-slot');
        put(244, 106, 'start', labels.right, 'cross-slot');
        put(150, 188, 'middle', labels.down, 'cross-slot');
        put(56, 106, 'end', labels.left, 'cross-slot');
        put(150, 106, 'middle', labels.center, 'cross-center');
    }

    /** 十字のラベルと、押せない操作の無効化をまとめて描き直す */
    render() {
        const labels = this.h.labels();
        CrossModel.paint(document.getElementById(`${this.p}-cross`), labels);
        CrossModel.SLOTS.forEach(slot => ['cw', 'ccw'].forEach(dir => {
            const b = document.getElementById(`btn-${this.p}-rot-${slot}-${dir}`);
            if (b) b.disabled = !labels || !this.h.canCycle(slot, dir);
        }));
        CrossModel.EDGES.forEach(e => {
            const b = document.getElementById(`btn-${this.p}-mirror-${e.edge}`);
            if (b) b.disabled = !labels || !this.h.canMirror(e.axis);
        });
    }

    /** 同じ結果になる2辺（左辺と右辺／上辺と下辺）を短く光らせる */
    flash(axis) {
        CrossModel.EDGES.filter(e => e.axis === axis).forEach(e => {
            const el = document.getElementById(`btn-${this.p}-mirror-${e.edge}`);
            if (!el) return;
            el.classList.add('cross-mirror-flash');
            setTimeout(() => el.classList.remove('cross-mirror-flash'), 420);
        });
    }
}

CrossModel.SLOTS = ['up', 'right', 'down', 'left'];
CrossModel.SLOT_JA = { up: '上', right: '右', down: '下', left: '左' };
// 外枠の4辺 → 鏡の向き。**辺は4つだが結果は2通り**（左辺と右辺・上辺と下辺は同じ操作）。
// 辺に鏡を立てると考えると、縦の辺は左右を、横の辺は上下を映すことになる
CrossModel.EDGES = [
    { edge: 'left', axis: 'vertical' }, { edge: 'right', axis: 'vertical' },
    { edge: 'top', axis: 'horizontal' }, { edge: 'bottom', axis: 'horizontal' }
];

// ===== 立体のタイムアタック（M2.5-C） =====
//
// お題の立体異性体と**同じ分子**を、操作で作るまでの時間・手数を競う
// （ルービックキューブ／マインスイーパー的。DEVELOPMENT.md M2.5-C）。
// 操作系は M2.5-B（FischerPractice）の土台を継承するが、**ボタンは作り直してある**。
//
// **操作は4種類だけ。すべて紙の上で許される手**（2026-08-01 ユーザー確定。検品レビュー C-5c）:
//
//   | 操作                                  | 置換       | 分子 | 逆操作     |
//   |---------------------------------------|-----------|------|-----------|
//   | ⟳ / ⟲ 回す（1つ固定して残り3つを送る） | 3巡回（偶）| 同じ | 互いに逆   |
//   | ↔ 縦軸の鏡（左右が入れ替わる）         | 互換（奇） | 鏡像 | 自分自身   |
//   | ↕ 横軸の鏡（上下が入れ替わる）         | 互換（奇） | 鏡像 | 自分自身   |
//
// **すべての逆操作が自明なので、最短手数を学習者が自分で数えられる。**
// 180°回転のボタンは置かない（↔ のあと ↕ がちょうど180°回転になるので導出できる）。
// v343〜v361 の「⟳ ＝ 90°回転＋左右反転」は**廃止**した——⟲ が逆にならず
// （続けると180°回転になる）、2回押すと元に戻る＝回転として振る舞わないので、
// 最短手数の土台が成り立たなかった。90°回転・180°回転はレクチャーの題材へ移す。
// **練習モード（'fp'）は据え置き**（分子を変えない操作だけを並べる別のねらい）。
//
// UI は**十字の模型**（renderCross）。各スロットの両側に回転ボタンを置き、
// **押したスロットが「固定する枝」**になる ＝「軸を選ぶ→回す」の2段が1タップになる。
// 外枠の4辺が鏡ボタンで、**左辺・右辺＝縦軸の鏡／上辺・下辺＝横軸の鏡**。
// 辺は4つだが結果は2通りしかない＝**鏡像は1つしかない**と気づくこと自体が学び。
// 押したときに対になる辺が同時に光る（flashMirrorPair）ようにしてある。
//
// 完成の判定は canonicalStereoCode の一致（StereoQuiz.relationOf === 'same'）だけで済み、
// **図の向きが違っていても同じ分子なら完成**とする（見た目ではなく分子で判定する）。
class StereoTimeAttack extends FischerPractice {
    constructor(game) {
        super(game, { prefix: 'ta', modalId: 'time-attack-modal', openBtnId: 'btn-time-attack' });
        if (!this.modal) return;
        this.timerEl = document.getElementById('ta-timer');
        this.modeEl = document.getElementById('ta-mode');
        this.timerId = null;
        this.startTime = null;
        this.finalMs = null;
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.newQuestion());
        // 十字の模型（記号パズルと共通の操作面）。押したスロットが固定軸になる
        this.cross = new CrossModel('ta', {
            labels: () => this.crossLabels(),
            canCycle: (slot, dir) => !!(this.current && !this.finished &&
                fischerOpCycle(this.game, this.current.targetB, this.selCenter, slot, dir)),
            canMirror: (axis) => !!(this.current && !this.finished &&
                fischerOpMirror(this.game, this.current.targetB, this.selCenter, axis)),
            onCycle: (slot, dir) => this.applyCrossCycle(slot, dir),
            onMirror: (axis) => this.applyCrossMirror(axis)
        });
        this.bestBtn = document.getElementById('btn-ta-best');
        this.bestOps = null;
        this._replaying = false;
        if (this.bestBtn) this.bestBtn.addEventListener('click', () => this.replayShortest());
        // 閉じるときはタイマーも止める（ボタン自体の開閉は親クラスが処理する）
        document.getElementById('btn-ta-close').addEventListener('click', () => this.stopTimer());
    }

    newQuestion() {
        this.build();
        this.stopTimer();
        const mode = this.modeEl ? this.modeEl.value : 'all';
        const pool = this.pool.filter(e =>
            mode === '1' ? e.centers === 1
                : (mode === 'multi' || mode === 'advanced') ? e.centers >= 2 : true);
        if (!pool.length) {
            if (this.statusEl) this.statusEl.textContent = 'この範囲で出題できる分子がありません。';
            return;
        }
        // 上級は「**中心を切り替えないと解けない**」お題だけを出す（2026-08-01 ユーザー要望）。
        // 立体の違う中心が2か所以上あるので、①②…を選び直しながら入れ替えることになる。
        // 判定は最短手順の探索に任せる: 最短手順の中で**入れ替える中心が2種類以上**なら合格
        const advanced = mode === 'advanced';
        let q = null;
        for (let tries = 0; tries < (advanced ? 120 : 60) && !q; tries++) {
            const e = pool[Math.floor(Math.random() * pool.length)];
            // お題と立体の違う異性体を、中心の反転で作る（＋見た目も少しかき混ぜる）
            let tB = e.target;
            const centers = this.readableCenters(tB);
            if (advanced && centers.length < 2) continue;
            const flips = advanced
                ? 2 + Math.floor(Math.random() * (centers.length - 1))
                : 1 + Math.floor(Math.random() * centers.length);
            const shuffled = centers.slice().sort(() => Math.random() - 0.5).slice(0, flips);
            for (const ci of shuffled) {
                const r = fischerOpSwap(this.game, tB, ci);
                if (r) tB = r;
            }
            tB = this.scramble(tB, Math.floor(Math.random() * 2));
            const rel = StereoQuiz.relationOf(
                this.game.createTargetFromData({ target: e.target }),
                this.game.createTargetFromData({ target: tB }));
            // メソ体などで反転が打ち消されて同じ分子に戻った場合は出題しない
            if (rel !== 'enantiomer' && rel !== 'diastereomer') continue;
            const cand = { entry: e, targetA: e.target, targetB: tB, base: tB, how: 'attack' };
            if (advanced) {
                const ops = this.shortestSolution(6, 4000, cand);
                if (!ops) continue;
                const used = new Set(ops.filter(o => o.kind === 'mirror').map(o => o.center));
                if (used.size < 2) continue; // 1つの中心だけで解けるものは上級ではない
            }
            q = cand;
        }
        if (!q) {
            if (this.statusEl) this.statusEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.moves = 0;
        this.finished = false;
        this.finalMs = null;
        this.selCenter = null;
        this.selAxis = 'up';
        this.clearBestReplay();
        if (this.taskEl) {
            this.taskEl.textContent =
                `お題: 「${q.entry.name}」。右の図を操作して、左と同じ分子（同じ立体異性体）を作ってください。` +
                '図の向きや並びは違っていて構いません（判定は分子で行います）。' +
                (advanced ? '【上級】立体の違う中心が2か所以上あります。①②… を選び直しながら入れ替えてください。' : '');
        }
        renderMoleculeIntoSvg(this.game, 'ta-svg-a', q.targetA, false);
        this.startTime = Date.now();
        this.timerId = setInterval(() => this.renderTimer(), 100);
        this.refresh(true);
    }

    // 最短手順の再生をしまう（次のお題・やり直しのたびに呼ぶ）
    clearBestReplay() {
        this.bestOps = null;
        this._replaying = false;
        if (this.bestBtn) this.bestBtn.classList.add('hidden');
    }

    // やり直し: 図を最初に戻し、タイマーも仕切り直す
    resetFigure() {
        if (!this.current) return;
        this.current.targetB = this.current.base;
        this.moves = 0;
        this.finished = false;
        this.finalMs = null;
        this.clearBestReplay();
        this.stopTimer();
        this.startTime = Date.now();
        this.timerId = setInterval(() => this.renderTimer(), 100);
        this.refresh(true);
    }

    /** 十字の模型: 押したスロットを固定して残り3つを送る（3巡回＝偶置換。分子は変わらない） */
    applyCrossCycle(slot, dir) {
        if (!this.current || this.finished || this._replaying) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に回す中心（C）を選んでください。';
            return;
        }
        const r = fischerOpCycle(this.game, this.current.targetB, this.selCenter, slot, dir);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    'この回し方はこの図では行えません（枝どうしが重なるか、枝の中の別の不斉炭素原子の読みが壊れるため）。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /** 十字の模型: 外枠の辺の鏡（縦軸＝左右／横軸＝上下の入れ替え。互換1回＝奇置換） */
    applyCrossMirror(axis) {
        if (!this.current || this.finished || this._replaying) return;
        if (this.selCenter === null) {
            if (this.statusEl) this.statusEl.textContent = '先に反転させる中心（C）を選んでください。';
            return;
        }
        const r = fischerOpMirror(this.game, this.current.targetB, this.selCenter, axis);
        if (!r) {
            if (this.statusEl) {
                this.statusEl.textContent =
                    `この中心では${axis === 'vertical' ? '縦軸' : '横軸'}の鏡が使えません（枝どうしが重なるため）。` +
                    'もう一方の向きの鏡か、先に回してみてください。';
            }
            return;
        }
        this.current.targetB = r;
        this.moves++;
        this.refresh(false);
    }

    /**
     * お題のかき混ぜは**パズルで押せる操作だけ**（＝スロット固定の3巡回）で行う。
     * 親クラスは 90°回転・180°回転も混ぜるが、それらはパズルから外したので、
     * 学習者が再現できない図から始めることになってしまう。
     */
    scramble(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const centers = this.readableCenters(t);
            if (!centers.length) break;
            const ci = centers[Math.floor(Math.random() * centers.length)];
            const slot = CrossModel.SLOTS[Math.floor(Math.random() * 4)];
            const r = fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw');
            if (r) t = r;
        }
        return t;
    }

    /**
     * お題と、いま操作している図で**立体が食い違っている中心の数**。
     * 回転は分子を変えないので、これがそのまま**最短手数の下限**になる
     * （鏡は1手につきちょうど1つの中心を反転させるため）。
     * 読めない・対応づけできない場合は null（下限を主張しない）。
     */
    mismatchCount(q = this.current) {
        if (!q) return null;
        const molA = this.game.createTargetFromData({ target: q.targetA });
        const molB = this.game.createTargetFromData({ target: q.base });
        const sa = readStereoOf(molA), sb = readStereoOf(molB);
        if (!sa || !sb) return null;
        const cmp = stereoIsomorphismCompare(molA, sa.stereo, molB, sb.stereo);
        if (!cmp || !cmp.centers) return null;
        return cmp.centers.filter(x => !x.match).length;
    }

    /**
     * 最短手順を幅優先で求める（2026-08-01 ユーザー要望「実は最短は…」）。
     *
     * 完成の判定は**分子**で、回転（3巡回＝偶置換）は分子を変えない。だから最短は
     * ふつう「立体が違う中心を鏡で1つずつ反転させる」だけ ＝ 回転は1手も要らない。
     * ただし枝が重なって**両方の鏡が使えない**中心があり、そのときだけ先に回す必要がある。
     *
     * そこで **(1) 鏡だけの探索**を先に走らせる。得られた手数が下限（食い違う中心の数）に
     * 届いていればそれが最短と確定できるので、そこで打ち切る（十字の操作は分岐が多く、
     * 回転まで混ぜた全探索は上級の出題づくりで何度も回すと重すぎる）。
     * 届かなかったときだけ **(2) 回転を混ぜた探索**を、鏡だけの手数より浅い範囲で試す。
     * 図の見た目（drawingKey）で重複を除き、深さと節点数で打ち切る（見つからなければ null）。
     */
    shortestSolution(maxDepth = 6, maxNodes = 4000, q = this.current) {
        if (!q) return null;
        const mirrorOnly = this.searchSolution(q, maxDepth, maxNodes, false);
        const floor = this.mismatchCount(q);
        if (mirrorOnly && floor !== null && mirrorOnly.length <= floor) return mirrorOnly;
        const cap = mirrorOnly ? mirrorOnly.length - 1 : maxDepth;
        return this.searchSolution(q, cap, maxNodes, true) || mirrorOnly;
    }

    /** shortestSolution の本体。withCycles=false なら鏡だけを候補にする */
    searchSolution(q, maxDepth, maxNodes, withCycles) {
        if (!q || maxDepth < 1) return null;
        const molA = this.game.createTargetFromData({ target: q.targetA });
        const isSame = t => StereoQuiz.relationOf(
            molA, this.game.createTargetFromData({ target: t })) === 'same';
        const start = q.base;
        if (isSame(start)) return [];
        const seen = new Set([FischerPractice.drawingKey(start)]);
        let frontier = [{ t: start, ops: [] }];
        let nodes = 0;
        for (let depth = 1; depth <= maxDepth && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                const cands = [];
                this.readableCenters(cur.t).forEach(ci => {
                    ['vertical', 'horizontal'].forEach(axis => {
                        const m = fischerOpMirror(this.game, cur.t, ci, axis);
                        if (m) cands.push({ t: m, op: { kind: 'mirror', center: ci, axis } });
                    });
                    if (!withCycles) return;
                    CrossModel.SLOTS.forEach(slot => {
                        ['cw', 'ccw'].forEach(dir => {
                            const r = fischerOpCycle(this.game, cur.t, ci, slot, dir);
                            if (r) cands.push({ t: r, op: { kind: 'cycle', center: ci, slot, dir } });
                        });
                    });
                });
                for (const c of cands) {
                    if (++nodes > maxNodes) return null;
                    const key = FischerPractice.drawingKey(c.t);
                    if (seen.has(key)) continue;
                    seen.add(key);
                    const ops = cur.ops.concat([c.op]);
                    if (isSame(c.t)) return ops;
                    next.push({ t: c.t, ops });
                }
            }
            frontier = next;
        }
        return null;
    }

    /** 手順1つぶんの読み上げ（最短手順の再生で使う） */
    static opLabel(op) {
        if (op.kind === 'mirror') {
            return op.axis === 'vertical' ? '↔ 縦軸の鏡（左右が入れ替わる）'
                                          : '↕ 横軸の鏡（上下が入れ替わる）';
        }
        return `${op.dir === 'cw' ? '⟳' : '⟲'} ${CrossModel.SLOT_JA[op.slot]}を固定して回す`;
    }

    // 最短手順を、お題の最初の図から1手ずつ再生する（自分の手順と見比べるため）
    replayShortest() {
        if (!this.current || !this.bestOps || this._replaying) return;
        this._replaying = true;
        this.current.targetB = this.current.base;
        this.selCenter = null;
        this.refresh(false);
        const total = this.bestOps.length;
        let i = 0;
        const tick = () => {
            if (i >= total) {
                this._replaying = false;
                if (this.statusEl && this._finishText) {
                    this.statusEl.textContent =
                        `▶ 最短手順（${total}手）の再生おわり。あなたは ${this.moves}手でした。\n` + this._finishText;
                    this.statusEl.className = 'result-message success';
                } else {
                    this.updateStatus();
                }
                return;
            }
            const op = this.bestOps[i++];
            this.selCenter = op.center; // どの中心に効かせた手なのかを先に見せる
            const t = op.kind === 'mirror'
                ? fischerOpMirror(this.game, this.current.targetB, op.center, op.axis)
                : fischerOpCycle(this.game, this.current.targetB, op.center, op.slot, op.dir);
            if (t) this.current.targetB = t;
            this.refresh(false);
            if (this.statusEl) {
                this.statusEl.className = '';
                this.statusEl.textContent =
                    `▶ 最短手順の再生（${i}/${total}手）: ${StereoTimeAttack.opLabel(op)}`;
            }
            setTimeout(tick, 950);
        };
        if (this.statusEl) {
            this.statusEl.className = '';
            this.statusEl.textContent = 'お題の最初の図に戻しました。ここから最短手順を再生します。';
        }
        setTimeout(tick, 700);
    }

    stopTimer() {
        if (this.timerId) { clearInterval(this.timerId); this.timerId = null; }
    }

    renderTimer() {
        if (!this.timerEl) return;
        const ms = this.finished ? this.finalMs : (this.startTime ? Date.now() - this.startTime : 0);
        this.timerEl.textContent = `${((ms || 0) / 1000).toFixed(1)}秒`;
    }

    // 自己ベスト（分子ごと）。localStorage が使えない環境では黙って諦める
    updateRecord(name, ms, moves) {
        let all = {};
        try { all = JSON.parse(localStorage.getItem('chemAssemblerTimeAttack') || '{}') || {}; } catch (e) {}
        const prev = all[name];
        const isNew = !prev || ms < prev.ms;
        if (isNew) {
            all[name] = { ms, moves };
            try { localStorage.setItem('chemAssemblerTimeAttack', JSON.stringify(all)); } catch (e) {}
        }
        return { isNew, ms: isNew ? ms : prev.ms, moves: isNew ? moves : prev.moves };
    }

    updateStatus() {
        if (!this.current) return;
        if (this._replaying) { this.renderTimer(); return; } // 再生中の文言は replayShortest が持つ
        const rel = this.currentRelation();
        if (rel === 'same' && !this.finished) {
            // 完成。タイマーを止め、記録を更新する
            this.finished = true;
            this.finalMs = Date.now() - this.startTime;
            this.stopTimer();
            const best = this.updateRecord(this.current.entry.name, this.finalMs, this.moves);
            const sec = (this.finalMs / 1000).toFixed(1);
            // 「実は最短は…」を出す（2026-08-01 ユーザー要望）。
            // 探索が打ち切られた場合（null）は黙って出さない＝嘘の手数を出さない
            this.bestOps = this.shortestSolution();
            if (this.statusEl) {
                let text =
                    `🏁 完成！「${this.current.entry.name}」と同じ分子になりました（${sec}秒・${this.moves}手）。\n` +
                    (best.isNew ? '🥇 自己ベスト更新！'
                                : `自己ベスト: ${(best.ms / 1000).toFixed(1)}秒・${best.moves}手`);
                if (this.bestOps) {
                    const n = this.bestOps.length;
                    text += `\n実は最短は ${n}手 です（あなたは ${this.moves}手）。` +
                        (this.moves === n ? ' ぴったり最短でした！'
                                          : ' 下のボタンで、お題の最初から最短手順を再生できます。');
                }
                text += '\n図の向きが違っていても、同じ分子なら完成です（判定は図ではなく分子）。';
                this._finishText = text; // 最短手順の再生が終わったら、この要約に戻す
                this.statusEl.textContent = text;
                this.statusEl.className = 'result-message success';
            }
            if (this.bestBtn) this.bestBtn.classList.toggle('hidden', !this.bestOps || !this.bestOps.length);
        } else if (!this.finished) {
            const relText = {
                enantiomer: '鏡像異性体（すべての中心の立体が逆）',
                diastereomer: '別の立体異性体（一部の中心の立体が逆）'
            }[rel] || '別の分子';
            if (this.statusEl) {
                this.statusEl.textContent =
                    `いま右の分子は、お題とは ${relText} です。\n` +
                    '回しても立体異性体は変わりません。立体が違う中心（C）を選び、外枠の「鏡」を押しましょう。';
                this.statusEl.className = '';
            }
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
        this.renderTimer();
    }

    refresh(resetStatus) {
        super.refresh(resetStatus);
        this.renderCross();
    }

    renderCross() {
        if (this.cross) this.cross.render();
    }

    /**
     * 十字に並べるラベル。選んでいる中心の4スロット（**暗黙の H も1つのスロット**）に
     * 置換基の名前を置く。H のところだけ回転ボタンが押せないと十字の模型として
     * 不整合になるので、H もふつうのスロットとして扱う（C-5c）。
     * 出題前・立体が読めないときは null（＝空の十字）。
     */
    crossLabels() {
        const mol = this.current ? this.molB : null;
        const center = (mol && this.selCenter !== null) ? mol.atoms[this.selCenter] : null;
        const slots = center ? fischerSlots(mol, center.id) : null;
        if (!slots) return null;
        const label = k => slots[k] === 'H' ? 'H' : substituentLabel(mol, slots[k], center.id);
        return { up: label('up'), right: label('right'), down: label('down'),
                 left: label('left'), center: 'C' };
    }
}

// ===== 記号パズル（模式化した模型・ORDER_stereo_puzzle.md 第2段） =====
//
// 分子を使わず、4スロットに **A・B・C・D の記号**を置いた抽象モデルで同じ規則を練習する。
//   ・化学の知識が要らない（名前も分子式も出てこない）ので、**規則だけ**に集中できる
//   ・出題は4記号の並べ替え24通りから選ぶだけ ＝ **出題ストックが尽きない**
//   ・判定は**置換だけ**で、分子モデル（正準コード・立体の読み直し）を一切通らない＝軽い
// 操作面は立体タイムアタックと同じ CrossModel を使う。**同じ手つきのまま**、
// 模式モードで規則を覚え、分子モードで実物に当てるため。
//
// **完成の条件は「見本とぴったり同じ並び」**にした（分子モードの「同じ分子なら向きは自由」
// とは違う）。模式モードで偶奇だけを完成条件にすると**鏡を1回押せば必ず終わる**ので、
// C-5c のねらい（逆操作が自明だから最短手数を自分で数えられる）が消えてしまう。
// 偶奇（見本と同じ立体か・鏡像か）は毎手ごとに文言で出し、そちらで規則を教える。
class SymbolPuzzle {
    constructor() {
        this.modal = document.getElementById('symbol-puzzle-modal');
        if (!this.modal) return;
        this.goal = null;   // 見本の並び { up, right, down, left }
        this.start = null;  // お題の最初の並び（やり直し・最短手順の基点）
        this.slots = null;  // いま操作している並び
        this.moves = 0;
        this.finished = false;
        this.taskEl = document.getElementById('sp-task');
        this.statusEl = document.getElementById('sp-status');
        this.movesEl = document.getElementById('sp-moves');
        this.modeEl = document.getElementById('sp-mode');
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        on('btn-symbol-puzzle', () => this.open());
        on('btn-sp-close', () => this.modal.classList.add('hidden'));
        on('btn-sp-next', () => this.newQuestion());
        on('btn-sp-reset', () => this.resetFigure());
        if (this.modeEl) this.modeEl.addEventListener('change', () => this.newQuestion());
        this.cross = new CrossModel('sp', {
            labels: () => this.crossLabels(),
            // 模式モデルではどの操作も必ず成立する（枝が重なる・立体が読めない、が無い）。
            // 完成後だけ止める
            canCycle: () => !!this.slots && !this.finished,
            canMirror: () => !!this.slots && !this.finished,
            onCycle: (slot, dir) => this.apply({ kind: 'cycle', slot, dir }),
            onMirror: (axis) => this.apply({ kind: 'mirror', axis })
        });
    }

    open() {
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    /** 1つのスロットを固定して残り3つを送る（3巡回＝偶置換） */
    static cycle(slots, fixedSlot, dir) {
        const ring = CrossModel.SLOTS.filter(k => k !== fixedSlot);
        const step = dir === 'ccw' ? 2 : 1;
        const out = Object.assign({}, slots);
        for (let i = 0; i < 3; i++) out[ring[(i + step) % 3]] = slots[ring[i]];
        return out;
    }

    /** 向かい合う2スロットの入れ替え（互換1回＝奇置換）。縦軸＝左右／横軸＝上下 */
    static mirror(slots, axis) {
        const out = Object.assign({}, slots);
        if (axis === 'horizontal') { out.up = slots.down; out.down = slots.up; }
        else { out.left = slots.right; out.right = slots.left; }
        return out;
    }

    static key(slots) {
        return CrossModel.SLOTS.map(k => slots[k]).join('');
    }

    /**
     * 見本を基準にした置換の偶奇。**偶＝見本と同じ立体**（回転だけで届く）／
     * **奇＝見本の鏡像**（鏡が奇数回必要）。これが模式モデルの判定のすべて。
     */
    static parity(slots, goal) {
        const goalSeq = CrossModel.SLOTS.map(k => goal[k]);
        const perm = CrossModel.SLOTS.map(k => goalSeq.indexOf(slots[k]));
        let swaps = 0;
        for (let i = 0; i < perm.length; i++) {
            while (perm[i] !== i) {
                const j = perm[i];
                perm[i] = perm[j];
                perm[j] = j;
                swaps++;
            }
        }
        return swaps % 2 === 0 ? 'even' : 'odd';
    }

    /** 24通りの並べ替えをすべて作る */
    static allArrangements() {
        const out = [];
        const letters = SymbolPuzzle.SYMBOLS.map(s => s.text);
        const walk = (rest, acc) => {
            if (!rest.length) {
                out.push({ up: acc[0], right: acc[1], down: acc[2], left: acc[3] });
                return;
            }
            rest.forEach((x, i) => walk(rest.filter((_, j) => j !== i), acc.concat([x])));
        };
        walk(letters, []);
        return out;
    }

    newQuestion() {
        const all = SymbolPuzzle.allArrangements();
        this.goal = all[Math.floor(Math.random() * all.length)];
        const want = this.modeEl ? this.modeEl.value : 'all';
        const pool = all.filter(a => {
            if (SymbolPuzzle.key(a) === SymbolPuzzle.key(this.goal)) return false; // 最初から完成は出さない
            const p = SymbolPuzzle.parity(a, this.goal);
            return want === 'same' ? p === 'even' : want === 'mirror' ? p === 'odd' : true;
        });
        this.start = pool[Math.floor(Math.random() * pool.length)];
        this.slots = Object.assign({}, this.start);
        this.moves = 0;
        this.finished = false;
        this.bestOps = null;
        if (this.taskEl) {
            this.taskEl.textContent =
                '左の見本とぴったり同じ並びになるように、右の十字を操作してください。' +
                '記号そのものに意味はありません（分子の枝の代わり）。' +
                '使える手は分子のパズルとまったく同じ4種類です。';
        }
        this.refresh(true);
    }

    resetFigure() {
        if (!this.start) return;
        this.slots = Object.assign({}, this.start);
        this.moves = 0;
        this.finished = false;
        this.bestOps = null;
        this.refresh(true);
    }

    apply(op) {
        if (!this.slots || this.finished) return;
        this.slots = op.kind === 'mirror'
            ? SymbolPuzzle.mirror(this.slots, op.axis)
            : SymbolPuzzle.cycle(this.slots, op.slot, op.dir);
        this.moves++;
        this.refresh(false);
    }

    /** 見本までの最短手順（24通りしかないので幅優先で必ず出る） */
    shortest(from) {
        const start = from || this.start;
        if (!start || !this.goal) return null;
        const goalKey = SymbolPuzzle.key(this.goal);
        if (SymbolPuzzle.key(start) === goalKey) return [];
        const seen = new Set([SymbolPuzzle.key(start)]);
        let frontier = [{ s: start, ops: [] }];
        for (let depth = 1; depth <= 8 && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                const cands = [];
                CrossModel.SLOTS.forEach(slot => ['cw', 'ccw'].forEach(dir =>
                    cands.push({ s: SymbolPuzzle.cycle(cur.s, slot, dir), op: { kind: 'cycle', slot, dir } })));
                ['vertical', 'horizontal'].forEach(axis =>
                    cands.push({ s: SymbolPuzzle.mirror(cur.s, axis), op: { kind: 'mirror', axis } }));
                for (const c of cands) {
                    const k = SymbolPuzzle.key(c.s);
                    if (seen.has(k)) continue;
                    seen.add(k);
                    const ops = cur.ops.concat([c.op]);
                    if (k === goalKey) return ops;
                    next.push({ s: c.s, ops });
                }
            }
            frontier = next;
        }
        return null;
    }

    crossLabels() {
        return SymbolPuzzle.labelsOf(this.slots);
    }

    /** 並び1つを十字のラベルに直す（見本・選択肢の静止画にも使う） */
    static labelsOf(slots) {
        if (!slots) return null;
        const color = t => (SymbolPuzzle.SYMBOLS.find(s => s.text === t) || {}).color;
        const at = k => ({ text: slots[k], color: color(slots[k]) });
        return { up: at('up'), right: at('right'), down: at('down'), left: at('left'),
                 center: { text: '＋', color: 'rgba(224,176,255,0.9)' } };
    }

    /** 見本の十字（操作できない静止画） */
    renderGoal() {
        CrossModel.paint(document.getElementById('sp-goal'), SymbolPuzzle.labelsOf(this.goal));
    }

    refresh(resetStatus) {
        this.renderGoal();
        if (this.cross) this.cross.render();
        const matched = this.slots && SymbolPuzzle.key(this.slots) === SymbolPuzzle.key(this.goal);
        if (matched && !this.finished) {
            this.finished = true;
            this.bestOps = this.shortest();
            if (this.cross) this.cross.render(); // 完成したらボタンを止める
        }
        if (this.statusEl) {
            let text;
            if (this.finished) {
                text = `🎯 見本と同じ並びになりました（${this.moves}手）。`;
                if (this.bestOps) {
                    text += `\n最短は ${this.bestOps.length}手 です` +
                        (this.moves === this.bestOps.length ? '。ぴったり最短でした！'
                            : `（あなたは ${this.moves}手）。逆操作はぜんぶ自明なので、数えれば必ず分かります。`);
                }
            } else {
                const p = SymbolPuzzle.parity(this.slots, this.goal);
                text = p === 'even'
                    ? 'いまの並びは見本と「同じ立体」です（回転だけで見本に届きます）。'
                    : 'いまの並びは見本の「鏡像」です（回転だけでは届きません。鏡が奇数回いります）。';
                if (!resetStatus) text += '\n回すと並びは変わりますが、同じ立体か鏡像かは変わりません。';
            }
            this.statusEl.textContent = text;
            this.statusEl.className = this.finished ? 'result-message success' : '';
        }
        if (this.movesEl) this.movesEl.textContent = `手数: ${this.moves}`;
    }
}

// 記号は4つとも別の色にする（どの枝が動いたかを目で追えるように）
SymbolPuzzle.SYMBOLS = [
    { text: 'A', color: '#00f2fe' }, { text: 'B', color: '#ffa502' },
    { text: 'C', color: '#2ecc71' }, { text: 'D', color: '#e056fd' }
];

// ===== 「同じ立体はどれ？」4択（ORDER_stereo_puzzle.md 第3段） =====
//
// **見本1つに対して4つ示し、同じものを選ばせる。** 発注書で最優先とされた出題形式で、
// 理由は **静止画1枚で問いと選択肢が読める**こと（SNS のサムネとして最も強い。IDEAS.md §1）。
//
// 土台は第1段・第2段と同じなので**判定は1本で済む**:
//   ・記号（模式）… 見本を基準にした置換が**偶なら同じ立体**（SymbolPuzzle.parity）
//   ・分子       … StereoQuiz.relationOf === 'same'
// どちらのモードでも「正解は1つ・残り3つは鏡像（またはジアステレオマー）」に揃えてある。
// 正解の解説には**見本から何手で作れるか**を出す（回転だけで届く＝同じ立体、の実演）。
class StereoChoiceQuiz {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('choice-quiz-modal');
        if (!this.modal) return;
        this.kindEl = document.getElementById('pk-kind');
        this.taskEl = document.getElementById('pk-task');
        this.resultEl = document.getElementById('pk-result');
        this.scoreEl = document.getElementById('pk-score');
        this.score = { asked: 0, correct: 0 };
        this.current = null;
        this.pool = null;
        const on = (id, fn) => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('click', fn);
        };
        this.streakEl = document.getElementById('pk-streak');
        this.pairRow = document.getElementById('pk-pair-answer');
        this.pairBtns = ['btn-pk-same', 'btn-pk-diff']
            .map(id => document.getElementById(id)).filter(Boolean);
        this.streak = 0;
        this.pairStats = { n: 0, ms: 0 };
        on('btn-choice-quiz', () => this.open());
        on('btn-pk-close', () => this.modal.classList.add('hidden'));
        on('btn-pk-next', () => this.newQuestion());
        on('btn-pk-same', () => this.answerPair(true));
        on('btn-pk-diff', () => this.answerPair(false));
        if (this.kindEl) this.kindEl.addEventListener('change', () => this.newQuestion());
        for (let i = 0; i < 4; i++) {
            const cell = document.getElementById(`pk-cell-${i}`);
            if (cell) cell.addEventListener('click', () => this.answer(i));
        }
    }

    open() {
        this.modal.classList.remove('hidden');
        this.newQuestion();
    }

    /** フィッシャー投影として立体が読める分子（タイムアタックと同じ選び方） */
    build() {
        if (this.pool) return;
        this.pool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const info = readStereoOf(e.mol);
            if (info && !info.fromRing && info.geoms === 0 && info.centers >= 1 &&
                info.stereoCode !== info.mirrorCode) { // アキラルだと「鏡像＝同じ」で誤答が作れない
                this.pool.push(Object.assign({}, e, info));
            }
        });
    }

    /**
     * D/L の出題に使える図を集める（ORDER 第4段 4a）。
     *
     * **ライブラリに登録されている図だけを使う。鏡像はその場で作らない。**
     * 基準の中心を1つだけ反転させると D/L の文字は確かに裏返るが、**中心が2つ以上ある糖では
     * 別の化合物になる**（D-グルコースの5位だけを逆にしたものは L-グルコースではなく L-イドース）。
     * 解説で名前を出す以上、名乗れない図は出さない。
     * **180°回した図（flipped）も入れない**——「基準が右なら D」がそのままでは逆になる
     * 引っかけで、まずは定義どおりに読む練習にしたいため。
     */
    buildDL() {
        if (this.dlPool) return;
        this.dlPool = [];
        buildCompoundLibrary(this.game).forEach(e => {
            const d = assignDLDescriptor(e.mol);
            if (!d || d.flipped) return;
            this.dlPool.push({
                base: e.name.replace(/^[DL]-/, ''), name: e.name,
                target: e.target, letter: d.letter, kind: d.kind
            });
        });
    }

    /** 「D体はどれ？」: 見本は文字だけ。選択肢は4つとも別の化合物にして、規則を当てさせる */
    dlQuestion() {
        this.buildDL();
        for (let tries = 0; tries < 40; tries++) {
            const want = Math.random() < 0.5 ? 'D' : 'L';
            const right = this.dlPool.filter(x => x.letter === want);
            const wrong = this.dlPool.filter(x => x.letter !== want);
            if (!right.length || wrong.length < 3) break;
            const pickRight = right[Math.floor(Math.random() * right.length)];
            // 見た目で区別できるよう、選択肢は**別の化合物**からとる
            const used = new Set([pickRight.base]);
            const others = [];
            wrong.slice().sort(() => Math.random() - 0.5).forEach(x => {
                if (others.length >= 3 || used.has(x.base)) return;
                used.add(x.base);
                others.push(x);
            });
            if (others.length < 3) continue;
            const items = [pickRight].concat(others).sort(() => Math.random() - 0.5);
            return {
                kind: 'dl', want, items,
                goal: { letter: want },
                options: items.map(x => x.target),
                answer: items.findIndex(x => x.letter === want),
                task: `①〜④のうち、${want}体は どれ？ ` +
                      '（基準になる不斉炭素原子で、基準の置換基が右なら D・左なら L です）'
            };
        }
        return null;
    }

    /**
     * 「同じ？違う？」（発注書 第3段の残り）。左右に2つ示して2択で答えさせ、**連続で出して
     * 時間を計る**。判定は4択とまったく同じ（relationOf === 'same'）で、答え方だけ変えたもの。
     * 半分を「同じ（回しただけ）」、半分を「違う（どこかの中心を反転）」で出す。
     */
    pairQuestion() {
        this.build();
        if (!this.pool.length) return null;
        const keyOf = FischerPractice.drawingKey;
        for (let tries = 0; tries < 40; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            const centers = this.centersOf(e.target);
            if (!centers.length) continue;
            const wantSame = Math.random() < 0.5;
            let t = e.target;
            if (!wantSame) {
                const flips = 1 + Math.floor(Math.random() * centers.length);
                centers.slice().sort(() => Math.random() - 0.5).slice(0, flips).forEach(ci => {
                    const r = fischerOpMirror(this.game, t, ci, Math.random() < 0.5 ? 'vertical' : 'horizontal');
                    if (r) t = r;
                });
            }
            t = this.scrambleByCycles(t, 1 + Math.floor(Math.random() * 3));
            const rel = this.relTo(e.target, t);
            // メソ体などで反転が打ち消されることがあるので、**実際の関係で出題を決める**
            const isSame = rel === 'same';
            if (isSame !== wantSame) continue;
            if (isSame && keyOf(t) === keyOf(e.target)) continue; // 図までそっくりでは問題にならない
            return {
                kind: 'pair', entry: e, goal: e.target, options: [t],
                isSame, rel,
                task: `左右は同じ立体異性体でしょうか？（「${e.name}」の図です。向きは違っていて構いません）`
            };
        }
        return null;
    }

    newQuestion() {
        if (this._advance) { clearTimeout(this._advance); this._advance = null; } // 自動送りの取り消し
        const kind = this.kindEl ? this.kindEl.value : 'symbol';
        const q = kind === 'pair' ? this.pairQuestion()
            : kind === 'dl' ? this.dlQuestion()
            : kind === 'molecule' ? this.moleculeQuestion() : this.symbolQuestion();
        if (!q) {
            if (this.taskEl) this.taskEl.textContent = '出題できる組が見つかりませんでした。';
            return;
        }
        this.current = q;
        this.answered = false;
        if (this.taskEl) this.taskEl.textContent = q.task;
        this.render();
        if (this.resultEl) { this.resultEl.textContent = ''; this.resultEl.className = ''; }
    }

    /** 記号（模式）の出題: 正解＝偶置換1つ／誤答＝奇置換3つ */
    symbolQuestion() {
        const all = SymbolPuzzle.allArrangements();
        const goal = all[Math.floor(Math.random() * all.length)];
        const gKey = SymbolPuzzle.key(goal);
        const pick = (parity, n) => {
            const c = all.filter(a => SymbolPuzzle.key(a) !== gKey &&
                                      SymbolPuzzle.parity(a, goal) === parity);
            return c.sort(() => Math.random() - 0.5).slice(0, n);
        };
        const right = pick('even', 1);
        const wrong = pick('odd', 3);
        if (right.length < 1 || wrong.length < 3) return null;
        const options = right.concat(wrong).sort(() => Math.random() - 0.5);
        return {
            kind: 'symbol', goal, options,
            answer: options.findIndex(o => SymbolPuzzle.parity(o, goal) === 'even'),
            task: '左が見本です。①〜④のうち、見本と「同じ立体」（回すだけで見本に重ねられるもの）は どれ？'
        };
    }

    /** 分子の出題: 正解＝回転で崩した同じ分子／誤答＝鏡像やジアステレオマー */
    moleculeQuestion() {
        this.build();
        if (!this.pool.length) return null;
        const keyOf = FischerPractice.drawingKey;
        for (let tries = 0; tries < 40; tries++) {
            const e = this.pool[Math.floor(Math.random() * this.pool.length)];
            const centers = this.centersOf(e.target);
            if (!centers.length) continue;
            const right = this.scrambleByCycles(e.target, 1 + Math.floor(Math.random() * 3));
            // 誤答は「どこかの中心を反転させたもの」＝別の立体異性体。見た目も少し崩す
            const wrong = [];
            for (let k = 0; k < 24 && wrong.length < 3; k++) {
                let t = e.target;
                const flips = 1 + Math.floor(Math.random() * centers.length);
                centers.slice().sort(() => Math.random() - 0.5).slice(0, flips).forEach(ci => {
                    const r = fischerOpMirror(this.game, t, ci, Math.random() < 0.5 ? 'vertical' : 'horizontal');
                    if (r) t = r;
                });
                t = this.scrambleByCycles(t, Math.floor(Math.random() * 3));
                if (this.relTo(e.target, t) === 'same') continue; // 反転が打ち消し合った
                if (wrong.some(w => keyOf(w) === keyOf(t)) || keyOf(t) === keyOf(right)) continue;
                wrong.push(t);
            }
            if (wrong.length < 3) continue;
            if (this.relTo(e.target, right) !== 'same') continue;
            const options = [right].concat(wrong).sort(() => Math.random() - 0.5);
            return {
                kind: 'molecule', entry: e, goal: e.target, options,
                answer: options.findIndex(o => this.relTo(e.target, o) === 'same'),
                task: `左の見本は「${e.name}」です。①〜④のうち、見本と同じ立体異性体は どれ？` +
                      '（図の向きは違っていても構いません）'
            };
        }
        return null;
    }

    relTo(t1, t2) {
        return StereoQuiz.relationOf(this.game.createTargetFromData({ target: t1 }),
                                    this.game.createTargetFromData({ target: t2 }));
    }

    centersOf(target) {
        const mol = this.game.createTargetFromData({ target });
        return Object.keys(readAtomParityFromFischer(mol))
            .map(id => mol.atoms.findIndex(a => a.id === id))
            .filter(i => i >= 0);
    }

    /** パズルで押せる回転（スロット固定の3巡回）だけで図を崩す＝分子は変わらない */
    scrambleByCycles(target, steps) {
        let t = target;
        for (let i = 0; i < steps; i++) {
            const centers = this.centersOf(t);
            if (!centers.length) break;
            const ci = centers[Math.floor(Math.random() * centers.length)];
            const slot = CrossModel.SLOTS[Math.floor(Math.random() * 4)];
            const r = fischerOpCycle(this.game, t, ci, slot, Math.random() < 0.5 ? 'cw' : 'ccw');
            if (r) t = r;
        }
        return t;
    }

    render() {
        const q = this.current;
        const isSymbol = q.kind === 'symbol';
        const clear = (svg) => {
            svg.querySelector('.quiz-bonds').innerHTML = '';
            svg.querySelector('.quiz-atoms').innerHTML = '';
            svg.querySelector('.cross-labels').innerHTML = '';
        };
        const paint = (svgId, data) => {
            const svg = document.getElementById(svgId);
            if (!svg) return;
            const art = svg.querySelector('.pk-cross-art');
            if (art) art.style.display = isSymbol ? '' : 'none';
            if (isSymbol) {
                clear(svg);
                svg.setAttribute('viewBox', '0 0 300 200');
                CrossModel.paint(svg, SymbolPuzzle.labelsOf(data));
            } else {
                clear(svg);
                // 立体のクイズは向きを変えても鎖が一直線のままなので、ここでは畳んでよい
                // （「同じ化合物？」は主鎖を曲げて出すので畳まない。renderMoleculeIntoSvg の但し書き）
                renderMoleculeIntoSvg(this.game, svgId, data, false, true);
            }
        };
        if (q.kind === 'dl') {
            // 見本は分子ではなく「D」「L」の文字そのもの（＝これを探せ、というお題）
            const svg = document.getElementById('pk-goal');
            const art = svg.querySelector('.pk-cross-art');
            if (art) art.style.display = 'none';
            clear(svg);
            svg.setAttribute('viewBox', '0 0 300 200');
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', 150); t.setAttribute('y', 128);
            t.setAttribute('text-anchor', 'middle');
            t.setAttribute('class', 'pk-goal-letter');
            t.textContent = `${q.goal.letter}体`;
            svg.querySelector('.cross-labels').appendChild(t);
        } else {
            paint('pk-goal', q.goal);
        }
        q.options.forEach((o, i) => {
            paint(`pk-opt-${i}`, o);
            const cell = document.getElementById(`pk-cell-${i}`);
            if (cell) cell.classList.remove('pk-cell-right', 'pk-cell-wrong');
        });
        // 「同じ？違う？」は図を1つだけ出し、答え方を2択のボタンにする
        const pair = q.kind === 'pair';
        for (let k = 1; k < 4; k++) {
            const cell = document.getElementById(`pk-cell-${k}`);
            if (cell) cell.classList.toggle('hidden', pair);
        }
        const badge0 = document.querySelector('#pk-cell-0 .pk-badge');
        if (badge0) badge0.textContent = pair ? '' : '①';
        if (this.pairRow) this.pairRow.classList.toggle('hidden', !pair);
        if (this.pairBtns) {
            this.pairBtns.forEach(b => { b.disabled = false; });
        }
        if (this.scoreEl) {
            this.scoreEl.textContent = this.score.asked
                ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
        }
        if (this.streakEl) this.streakEl.textContent = this.streakText();
        this.askedAt = Date.now();
    }

    /** 連続正解と平均の解答時間（タイムアタックの手ごたえ） */
    streakText() {
        if (!this.pairStats || !this.pairStats.n) return '';
        const avg = (this.pairStats.ms / this.pairStats.n / 1000).toFixed(1);
        return `連続 ${this.streak} 問正解 ／ 平均 ${avg}秒`;
    }

    /** 「同じ？違う？」の答え合わせ。said=true が「同じ立体」 */
    answerPair(said) {
        const q = this.current;
        if (!q || q.kind !== 'pair' || this.answered) return;
        this.answered = true;
        const ok = said === q.isSame;
        const ms = this.askedAt ? Date.now() - this.askedAt : 0;
        this.pairStats = this.pairStats || { n: 0, ms: 0 };
        this.pairStats.n++;
        this.pairStats.ms += ms;
        this.streak = ok ? (this.streak || 0) + 1 : 0;
        this.score.asked++;
        if (ok) this.score.correct++;
        if (this.pairBtns) this.pairBtns.forEach(b => { b.disabled = true; });
        const REL = {
            same: '同じ立体異性体（回しただけの図）',
            enantiomer: '鏡像異性体（すべての中心の立体が逆）',
            diastereomer: '別の立体異性体（一部の中心だけが逆）'
        };
        if (this.resultEl) {
            this.resultEl.textContent =
                (ok ? `⭕ 正解！（${(ms / 1000).toFixed(1)}秒）` : '❌ 不正解。') +
                ` 答えは「${REL[q.rel] || q.rel}」でした。` +
                (q.isSame
                    ? '回す操作（1つ固定して残り3つを送る）だけで重ねられます。'
                    : '回すだけでは重なりません。どこかの中心で左右か上下が入れ替わっています。');
            this.resultEl.className = ok ? 'result-message success' : 'result-message error';
        }
        if (this.scoreEl) this.scoreEl.textContent = `成績: ${this.score.correct} / ${this.score.asked}`;
        if (this.streakEl) this.streakEl.textContent = this.streakText();
        // 連続で出すのがこの形式のねらいなので、正解なら自動で次へ送る
        if (ok) this._advance = setTimeout(() => this.newQuestion(), 1200);
    }

    answer(i) {
        const q = this.current;
        if (!q || this.answered) return;
        this.answered = true;
        const ok = i === q.answer;
        this.score.asked++;
        if (ok) this.score.correct++;
        q.options.forEach((o, k) => {
            const cell = document.getElementById(`pk-cell-${k}`);
            if (!cell) return;
            if (k === q.answer) cell.classList.add('pk-cell-right');
            else if (k === i) cell.classList.add('pk-cell-wrong');
        });
        if (this.resultEl) {
            this.resultEl.textContent = (ok ? '⭕ 正解！ ' : `❌ 不正解。正解は ${'①②③④'[q.answer]} です。 `) +
                this.explain(q, i);
            this.resultEl.className = ok ? 'result-message success' : 'result-message error';
        }
        if (this.scoreEl) this.scoreEl.textContent = `成績: ${this.score.correct} / ${this.score.asked}`;
    }

    explain(q, picked) {
        if (q.kind === 'dl') {
            const RULE = {
                amino: 'α炭素（-NH₂ と -COOH が付いた炭素）の -NH₂',
                sugar: 'カルボニル（-CHO / C=O）からいちばん遠い不斉炭素原子（＝最下位）の -OH',
                hydroxyacid: '-COOH からいちばん遠い不斉炭素原子（＝最下位）の -OH'
            };
            const right = q.items[q.answer];
            let s = `${'①②③④'[q.answer]} は ${right.name}。` +
                `${RULE[right.kind]} が${right.letter === 'D' ? '右' : '左'}にあるので ${right.letter}体です。`;
            if (picked !== q.answer) {
                const p = q.items[picked];
                s += `\n選んだ ${'①②③④'[picked]} は ${p.name}で、${RULE[p.kind]} が` +
                     `${p.letter === 'D' ? '右' : '左'}にあるので ${p.letter}体でした。`;
            }
            s += `\n（ほかは ${q.items.filter((_, k) => k !== q.answer)
                .map(x => `${x.name}＝${x.letter}体`).join('・')}）`;
            return s;
        }
        if (q.kind === 'symbol') {
            const route = this.rotationRoute(q.options[q.answer], q.goal);
            let s = `${'①②③④'[q.answer]} は見本と偶数回の入れ替えぶんだけ違う＝回すだけで見本に重なります`;
            if (route) {
                s += route.length
                    ? `（${route.map(o => `${o.dir === 'cw' ? '⟳' : '⟲'} ${CrossModel.SLOT_JA[o.slot]}を固定`).join(' → ')} の${route.length}手）`
                    : '（見本そのもの）';
            }
            s += '。ほかの3つは左右か上下が1回だけ入れ替わっている＝鏡像で、回しても重なりません。';
            if (picked !== q.answer) {
                s += `\n選んだ ${'①②③④'[picked]} は見本の鏡像です。`;
            }
            return s;
        }
        const rel = { enantiomer: '鏡像異性体', diastereomer: '別の立体異性体（一部の中心だけが逆）' };
        const others = q.options.map((o, k) => k === q.answer ? null : this.relTo(q.goal, o))
            .filter(Boolean);
        let s = `${'①②③④'[q.answer]} は見本を回しただけの図なので、同じ立体異性体です。`;
        s += `ほかの3つは ${[...new Set(others.map(r => rel[r] || r))].join('・')} です。`;
        if (picked !== q.answer) {
            s += `\n選んだ ${'①②③④'[picked]} は見本の ${rel[this.relTo(q.goal, q.options[picked])] || '別の分子'} でした。`;
        }
        return s;
    }

    /** 記号モードで「見本まで回転だけで何手か」（12通りしかないので幅優先で必ず出る） */
    rotationRoute(from, goal) {
        const gKey = SymbolPuzzle.key(goal);
        if (SymbolPuzzle.key(from) === gKey) return [];
        const seen = new Set([SymbolPuzzle.key(from)]);
        let frontier = [{ s: from, ops: [] }];
        for (let depth = 1; depth <= 6 && frontier.length; depth++) {
            const next = [];
            for (const cur of frontier) {
                for (const slot of CrossModel.SLOTS) {
                    for (const dir of ['cw', 'ccw']) {
                        const s = SymbolPuzzle.cycle(cur.s, slot, dir);
                        const k = SymbolPuzzle.key(s);
                        if (seen.has(k)) continue;
                        seen.add(k);
                        const ops = cur.ops.concat([{ slot, dir }]);
                        if (k === gKey) return ops;
                        next.push({ s, ops });
                    }
                }
            }
            frontier = next;
        }
        return null;
    }
}

// ===== 立体異性体の総数当て（P12-8 M2.5） =====
//
// 「この分子の立体異性体は何種類？」を4択で答えさせる。ねらいは
// **素朴な 2ⁿ が正しいとは限らない**ことを体験させること。崩れる理由は2通りある。
//   ① メソ体（分子内に対称面）… 酒石酸 2²=4 → 3
//   ② 環などの回転対称        … 乳酸3分子の環状エステル 2³=8 → 4
// 判定は countStereoisomers（chemistry.js）に置く。誤答の選択肢には必ず 2ⁿ を混ぜ、
// 「2ⁿ を選んだ」ときは畳み込みの理由を名指しで解説する。
//
// **出題は「立体の単位 5 個まで」に絞る**（UNIT_LIMIT。v980）。上限を外すと
// ライブラリの二糖4件（マルトース・ラクトース・セロビオース・スクロース）が入り、
// 「答えは 1024 種類」「512 種類」という問題ができる。実測でこれは出題に値しない:
//   - **二糖はどれも畳み込みが起きない**（folded=false・1024=2¹⁰ そのもの）。
//     つまりこのクイズの主眼「2ⁿ が崩れる」にまったく寄与していない
//   - 選択肢が 1023 / 1024 / 1025 / 2048 になり、**2の冪を選ぶだけ**の作業になる。
//     手で数えて確かめることも、畳み込みの有無を吟味することもできない
//   - 糖が出せなくなるわけではない。上限 5 でも鎖状アルドヘキソース（2⁴=16。
//     「16種類」は入試の定番）・ピラノース（2⁵=32）・フルクトフラノース（16）・
//     デオキシリボース（4）・グルコン酸（16）は残る
// 副次的に build() が 14.1 秒 → 0.8 秒になる（二糖4件の数え上げが 13.3 秒だった）が、
// **これは理由ではなく結果**。速さのために題材を削ったのではない。
//
// **高分子も出題しない**（isPolymerFragment。v1020）。実測でプール 159 件のうち2件が
// 高分子で、「ポリアセチレンの立体異性体は 6 種類」「ポリビニルアルコールは 8 種類」を
// 出題していた。これは**繰り返し単位を有限個（このアプリの図では3単位）で切った模型から出た数**で、
// 実物の高分子の立体規則性（イソタクチック／シンジオタクチック／アタクチック）とは別の話。
// **生徒が覚えると害になる数**なので外す。
//   - 重合度 n を明示して作問することは原理的には可能だが、**鎖の反転（頭↔尾）で重なる配置が
//     畳み込まれる**ため単純な 2ⁿ にならない。そこを扱わない限り数字が意味を持たず、
//     扱ったところで高校化学で使い道が無い。ユーザー判断で「外してよい」（2026-08-09）
//   - 判定は**名前に「ポリ」が付くかでは見ない**。見かけで書いた除外は将来必ず嘘をつく
//     （ナイロン66・PET・アルキルベンゼンスルホン酸ナトリウムのように「ポリ」が付かない
//     高分子の図がライブラリにある）。理由で書く ＝ 下の isPolymerFragment を参照
//   - **図そのものは消さない**。名称ライブラリ・付加重合/縮合重合・立体対照ビューでは
//     引き続き使える。外したのは**このクイズの出題プールからだけ**

class StereoCountQuiz {
    constructor(game) {
        this.game = game;
        this.basePool = null;   // 出題できる分子ぜんぶ
        this.pool = null;       // 出題範囲で絞ったもの（basePool の部分集合）
        this.current = null;
        this.score = { asked: 0, correct: 0 };
        this.modal = document.getElementById('count-quiz-modal');
        this.questionEl = document.getElementById('cq-question');
        this.choicesEl = document.getElementById('cq-choices');
        this.resultEl = document.getElementById('cq-result');
        this.scoreEl = document.getElementById('cq-score');
        this.seriesEl = document.getElementById('cq-series');
        const btn = document.getElementById('btn-count-quiz');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-cq-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-cq-next').addEventListener('click', () => this.nextQuestion());
        // 出題範囲（2026-08-09）。命名クイズ・同じ化合物？ には前からあり、ここだけ無かった
        if (this.seriesEl) this.seriesEl.addEventListener('change', () => { this.computePool(); this.nextQuestion(); });
    }

    open() {
        this.build();
        if (this.seriesEl) populateSeriesSelect(this.seriesEl, this.basePool);
        this.computePool();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    /**
     * 出題範囲の絞り込み（2026-08-09）。**他の2つのクイズと同じ規則**にする。
     *
     * 足した理由は2つ。
     * ・**油脂（トリオレイン C₅₇H₁₀₄O₆・重原子63個）のような巨大分子が混じる**と、
     *   図が潰れて読めない。化学として正しい出題なのでプールからは外さず、
     *   **使う側が選べる**ようにするのが筋
     * ・命名クイズ（`naming-series`）と 同じ化合物？（`quiz-series`）には前からあり、
     *   **ここだけ無かった**＝一貫性の穴だった
     *
     * 絞った結果が空になったら全体に戻す（保険。NamingQuiz.computePool と同じ）。
     */
    computePool() {
        if (!this.basePool) return;
        const filter = (this.seriesEl && this.seriesEl.value) || 'all';
        this.pool = this.basePool.filter(p => filter === 'all' || p.series === filter);
        if (this.pool.length === 0) this.pool = [...this.basePool];
    }

    build() {
        if (this.basePool) return;
        this.basePool = [];
        // 重複除けは**コードを1回だけ出して Set で引く**。
        // v925 まで `pool.some(p => p.code === canonicalCode(e.mol))` と書いていたため、
        // 同じ分子の正準コードを**プールの要素数だけ作り直して**いた（O(n²)。
        // 通過 199 件 × プール最大 161 で約1万6千回。実測 1.2 秒ぶん）。
        //
        const seen = new Set();
        buildCompoundLibrary(this.game).forEach(e => {
            // **高分子は出題しない**（2026-08-09・ユーザー検品）。理由は下の isPolymerFragment を参照。
            // 補足: R を含む図の立体を断定しないのは `assignRSDescriptor` の既定方針でもある
            // （chemistry.js「扱わないもの: …R（アルキル基の付け根）を含む図…」）ので、
            // **ここで外すと層をまたいで筋が通る**。
            if (StereoCountQuiz.isPolymerFragment(e.mol)) return;
            const info = countStereoisomers(e.mol, StereoCountQuiz.UNIT_LIMIT);
            // 立体の単位が1個以上あり、数え切れた分子だけを出題する
            if (info.overflow || info.naive < 2) return;
            // 同じ構造式の重複エントリ（D体/L体など）は1つに絞る
            const code = canonicalCode(e.mol);
            if (seen.has(code)) return;
            seen.add(code);
            this.basePool.push(Object.assign({}, e, info, { code }));
        });
        this.computePool();
    }

    /**
     * この図が「高分子の繰り返し単位を切り出したもの」か。
     *
     * 見かけ（名前に「ポリ」が付くか、原子数が多いか）では判定しない。**理由で判定する**:
     * このアプリの図で高分子を高分子にしているのは擬似元素 **`R`（価標1・ELEMENT_VALENCE の 'R'）**
     * ＝「ここから先も同じ繰り返しが続く」という印。R を含む図は有限の1分子ではなく
     * **鎖の一部**なので、そこに現れる立体の単位の数は「図を何単位で切ったか」で変わる
     * ＝ 数え上げた種類数は分子の性質ではなく作図の都合になる。
     * だから R の有無だけを見る。ポリアセチレンにも PET にもナイロン66にも同じ理由で効く。
     */
    static isPolymerFragment(mol) {
        return mol.atoms.some(a => a.element === 'R');
    }

    // 選択肢を作る: 正解＋2ⁿ（正解と違うとき）＋近い数。重複を除いて4つに整える
    static buildChoices(info) {
        const set = new Set([info.count]);
        if (info.naive !== info.count) set.add(info.naive);
        [info.count * 2, info.count + 1, Math.max(2, info.count - 1), info.naive + 1]
            .forEach(v => { if (set.size < 4 && v > 1) set.add(v); });
        let n = 2;
        while (set.size < 4) { set.add(info.count + n); n++; }
        return [...set].sort((a, b) => a - b);
    }

    nextQuestion() {
        this.build();
        if (!this.pool.length) { this.resultEl.textContent = '出題できる分子がありません。'; return; }
        // このクイズの要点は「2ⁿ が崩れる場合がある」ことなので、畳み込みが起きる分子を
        // 半々の確率で出す。ライブラリでは該当が少数（酒石酸など）で、
        // 素直に選ぶとほとんど出題されず、ねらいが伝わらない
        const folded = this.pool.filter(p => p.folded);
        const from = (folded.length && Math.random() < 0.5) ? folded : this.pool;
        const q = from[Math.floor(Math.random() * from.length)];
        renderMoleculeIntoSvg(this.game, 'cq-svg', reshapeGeometryForDisplay(this.game, q.target));
        const units = [];
        if (q.centers > 0) units.push(`不斉炭素原子 ${q.centers} 個`);
        if (q.bonds > 0) units.push(`シス/トランスのある C=C ${q.bonds} 本`);
        this.questionEl.textContent =
            `「${q.name}」（${q.formula}）の立体異性体は何種類ありますか？`;
        this.choicesEl.innerHTML = '';
        StereoCountQuiz.buildChoices(q).forEach(v => {
            const b = document.createElement('button');
            b.className = 'primary-btn';
            b.textContent = `${v} 種類`;
            b.dataset.value = String(v);
            b.addEventListener('click', () => this.answer(v, b));
            this.choicesEl.appendChild(b);
        });
        this.current = Object.assign({}, q, { units });
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.updateScore();
    }

    answer(said, clickedBtn) {
        if (!this.current || this.choicesEl.querySelector('button').disabled) return;
        const c = this.current;
        markQuizChoices(this.choicesEl.querySelectorAll('button'),
            b => Number(b.dataset.value) === c.count,
            clickedBtn || [...this.choicesEl.querySelectorAll('button')].find(b => Number(b.dataset.value) === said) || null);
        this.score.asked++;
        const correct = said === c.count;
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'count', correct: correct });
        const head = correct ? '⭕ 正解！' : `❌ 残念…正解は ${c.count} 種類。`;
        this.resultEl.textContent = head + ' ' + this.explain(c, said);
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
    }

    explain(c, said) {
        const base = `立体を決めるところは ${c.units.join('と')}。` +
            `それぞれ2通りなので、単純に数えると 2^${c.centers + c.bonds} = ${c.naive} 通りです。`;
        if (!c.folded) {
            return base + `この分子では重なるものが無いので、そのまま ${c.count} 種類になります。`;
        }
        const picked2n = said === c.naive
            ? '\n※ あなたが選んだのは「単純に数えた 2ⁿ」です。ここが引っかけどころで、'
            : '\nところが実際には ';
        return base + picked2n +
            `${c.naive} 通りのうち何組かは同じ分子で、区別できるのは ${c.count} 種類だけです。\n` +
            '理由は2通りあります。①分子内に対称面があって (R,S) と (S,R) が同じもの（メソ体。酒石酸が代表例）、' +
            '②環などに回転対称があり、数え始める位置が違うだけで同じもの。' +
            'このアプリは、分子を自分自身に重ねる写し方をすべて試して同じものをまとめているので、' +
            'どちらの理由でも正しく数えられます。';
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// 出題する立体の単位の上限（2⁵=32 まで）。理由はクラス上のコメント。
// countStereoisomers はこれを超えると数え上げずに overflow を返し、build() が弾く
StereoCountQuiz.UNIT_LIMIT = 5;

// ===== 命名クイズ（P8-4） =====

class NamingQuiz {
    constructor(game) {
        this.game = game;
        this.library = null;
        this.basePool = null; // 出題可能（名前がトポロジー的に一意）なエントリのindex
        this.pool = null;     // シリーズ絞り込み後
        this.current = null;
        this.score = { asked: 0, correct: 0 };

        this.modal = document.getElementById('naming-modal');
        this.resultEl = document.getElementById('naming-result');
        this.scoreEl = document.getElementById('naming-score');
        this.choicesEl = document.getElementById('naming-choices');
        this.seriesEl = document.getElementById('naming-series');
        this.strengthEl = document.getElementById('naming-strength');

        document.getElementById('btn-naming').addEventListener('click', () => this.open());
        document.getElementById('btn-naming-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-naming-next').addEventListener('click', () => this.nextQuestion());
        this.seriesEl.addEventListener('change', () => { this.computePool(); this.nextQuestion(); });
        this.strengthEl.addEventListener('change', () => this.nextQuestion());
    }

    strength() {
        return Number(this.strengthEl.value);
    }

    open() {
        this.build();
        populateSeriesSelect(this.seriesEl, this.library);
        this.computePool();
        this.modal.classList.remove('hidden');
        this.nextQuestion();
    }

    build() {
        if (this.library) return;
        this.library = buildCompoundLibrary(this.game);
        // 同一トポロジーで別名のエントリ（例: 2-ブテン／シス／トランス）は
        // 「正解が一意に決まらない」ため出題対象から除外する
        this.basePool = [];
        for (let i = 0; i < this.library.length; i++) {
            let ambiguous = false;
            for (let j = 0; j < this.library.length; j++) {
                if (i === j) continue;
                if (this.library[i].name !== this.library[j].name &&
                    this.library[i].formula === this.library[j].formula &&
                    verifyMolecule(this.library[i].mol, this.library[j].mol)) {
                    ambiguous = true;
                    break;
                }
            }
            if (!ambiguous) this.basePool.push(i);
        }
        this.computePool();
    }

    computePool() {
        if (!this.library) return;
        const filter = this.seriesEl.value || 'all';
        this.pool = this.basePool.filter(i => filter === 'all' || this.library[i].series === filter);
        if (this.pool.length === 0) this.pool = [...this.basePool]; // 空になった場合の保険
    }

    nextQuestion() {
        if (!this.pool || this.pool.length === 0) this.computePool();
        const idx = this.pool[Math.floor(Math.random() * this.pool.length)];
        const entry = this.library[idx];
        const strength = this.strength();

        // 意図的に正準形でない図: 強度に応じて表記変換を1〜2回かける
        const passes = strength === 0 ? 1 : (strength === 2 ? 2 : 1 + Math.floor(Math.random() * 2));
        let t = entry.target;
        for (let p = 0; p < passes; p++) t = transformCompoundDepiction(t, strength);
        renderMoleculeIntoSvg(this.game, 'naming-svg', t);

        // 選択肢: 正解 + 誤答3つ（同分子式の異性体名を優先。足りなければ他の名前で補完）
        const others = this.library.filter((e, i) => i !== idx && e.name !== entry.name);
        const sameFormula = shuffleArray(others.filter(e => e.formula === entry.formula).map(e => e.name));
        const rest = shuffleArray(others.filter(e => e.formula !== entry.formula).map(e => e.name));
        const distractors = [];
        [...sameFormula, ...rest].forEach(n => {
            if (distractors.length < 3 && n !== entry.name && !distractors.includes(n)) {
                distractors.push(n);
            }
        });
        const choices = shuffleArray([entry.name, ...distractors]);
        this.current = { entry, choices, answered: false };

        this.choicesEl.innerHTML = '';
        choices.forEach(nameText => {
            const btn = document.createElement('button');
            btn.textContent = nameText;
            btn.className = 'view-btn';
            btn.style.padding = '10px';
            btn.style.fontSize = '13px';
            btn.addEventListener('click', () => this.answer(nameText, btn));
            this.choicesEl.appendChild(btn);
        });
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.updateScore();
    }

    answer(nameText, clickedBtn) {
        if (!this.current || this.current.answered) return;
        this.current.answered = true;
        this.score.asked++;
        const correctName = this.current.entry.name;
        const correct = (nameText === correctName);
        if (correct) this.score.correct++;
        slTrack('quiz_answer', { app: 'assembler', quiz: 'naming', correct: correct });

        // 選んだものと正解の両方を残す（共通ヘルパー）。
        // 旧実装は枠線と文字色だけを inline で塗っていたが、disabled で薄くなった
        // ボタンの上ではほとんど見えなかった（2026-08-09 の実測）
        markQuizChoices(this.choicesEl.children, b => b.textContent === correctName, clickedBtn);

        const c = this.current;
        const points = describeStructure(c.entry.mol);
        const head = correct
            ? `⭕ 正解！「${correctName}」（分子式 ${c.entry.formula}）です。`
            : `❌ 残念…正解は「${correctName}」（分子式 ${c.entry.formula}）。回転や折れ曲がりに惑わされず、つながり方を順に確認しましょう。`;
        this.resultEl.textContent = `${head}\n構造のポイント: ${points.join('、')}`;
        this.resultEl.className = 'result-message ' + (correct ? 'success' : 'error');
        this.updateScore();
    }

    updateScore() {
        this.scoreEl.textContent = this.score.asked > 0 ? `成績: ${this.score.correct} / ${this.score.asked}` : '';
    }
}

// テスト（test.html）から参照するための公開。class 宣言は window に載らないため明示する
if (typeof window !== 'undefined') {
    window.StereoQuiz = StereoQuiz;
    window.StereoCountQuiz = StereoCountQuiz;
    window.FischerPractice = FischerPractice;
    window.StereoTimeAttack = StereoTimeAttack;
    window.CrossModel = CrossModel;
    window.SymbolPuzzle = SymbolPuzzle;
    window.StereoChoiceQuiz = StereoChoiceQuiz;
    window.condenseChainForDisplay = condenseChainForDisplay;
    window.findCondensableChainRuns = findCondensableChainRuns;
    window.renderMoleculeIntoSvg = renderMoleculeIntoSvg;
    window.reshapeGeometryForDisplay = reshapeGeometryForDisplay;
    window.rotateTargetInPlane = rotateTargetInPlane;
    window.readStereoOf = readStereoOf;
}
