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

    // 1. 90°単位の回転（1〜3回）＋50%で左右反転（剛体変換なのでシス/トランスも保存される）
    const cx = atoms.reduce((s, a) => s + a.x, 0) / atoms.length;
    const cy = atoms.reduce((s, a) => s + a.y, 0) / atoms.length;
    const turns = 1 + Math.floor(Math.random() * 3);
    for (let t = 0; t < turns; t++) {
        atoms.forEach(a => {
            const nx = cx - (a.y - cy);
            const ny = cy + (a.x - cx);
            a.x = nx;
            a.y = ny;
        });
    }
    if (Math.random() < 0.5) {
        atoms.forEach(a => { a.x = 2 * cx - a.x; });
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
        let ok = true;
        outer:
        for (let i = 0; i < moved.length; i++) {
            for (let j = i + 1; j < moved.length; j++) {
                if (Math.hypot(moved[i].x - moved[j].x, moved[i].y - moved[j].y) < GRID_SIZE * 0.65) {
                    ok = false;
                    break outer;
                }
            }
        }
        if (ok) {
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
                if (movingSet.size < 2 || movingSet.size === atoms.length) return;
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
            let bendOk = true;
            bendCheck:
            for (let i = 0; i < rotated.length; i++) {
                for (let j = i + 1; j < rotated.length; j++) {
                    if (Math.hypot(rotated[i].x - rotated[j].x, rotated[i].y - rotated[j].y) < GRID_SIZE * 0.65) {
                        bendOk = false;
                        break bendCheck;
                    }
                }
            }
            if (!bendOk) continue;
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
function renderMoleculeIntoSvg(game, svgId, target) {
    const svg = document.getElementById(svgId);
    const bondsGroup = svg.querySelector('.quiz-bonds');
    const atomsGroup = svg.querySelector('.quiz-atoms');
    bondsGroup.innerHTML = '';
    atomsGroup.innerHTML = '';

    const mol = game.createTargetFromData({ target });
    const hydrogens = mol.calculateHydrogens();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    [...mol.atoms, ...hydrogens].forEach(p => {
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    });
    const pad = 30;
    svg.setAttribute('viewBox', `${minX - pad} ${minY - pad} ${(maxX - minX) + pad * 2} ${(maxY - minY) + pad * 2}`);

    hydrogens.forEach(h => {
        const parent = mol.atoms.find(a => a.id === h.parentId);
        if (parent) game.renderTargetBond(parent.x, parent.y, h.x, h.y, 1, true, bondsGroup);
    });
    mol.bonds.forEach(b => {
        const a1 = mol.atoms.find(a => a.id === b.atomId1);
        const a2 = mol.atoms.find(a => a.id === b.atomId2);
        if (a1 && a2) game.renderTargetBond(a1.x, a1.y, a2.x, a2.y, b.type, false, bondsGroup);
    });
    hydrogens.forEach(h => game.renderTargetAtom('H', h.x, h.y, atomsGroup));
    mol.atoms.forEach(a => game.renderTargetAtom(a.element, a.x, a.y, atomsGroup));
    return mol;
}

// ===== 「同じ化合物？」クイズ（P8-3） =====

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

    nextQuestion() {
        if (!this.poolIndices || this.poolIndices.length === 0) this.computePools();
        const lib = this.library;
        const strength = this.strength();
        const wantSame = this.pairs.length === 0 ? true : Math.random() < 0.5;

        let entryA, entryB, targetA, targetB;
        if (wantSame) {
            const idx = this.poolIndices[Math.floor(Math.random() * this.poolIndices.length)];
            entryA = entryB = lib[idx];
            targetA = entryA.target;
            targetB = transformCompoundDepiction(entryA.target, strength);
        } else {
            let [i, j] = this.pairs[Math.floor(Math.random() * this.pairs.length)];
            if (Math.random() < 0.5) [i, j] = [j, i];
            entryA = lib[i];
            entryB = lib[j];
            // どちらも表記変換して「見た目の乱れ具合」では判別できないようにする
            targetA = transformCompoundDepiction(entryA.target, strength);
            targetB = transformCompoundDepiction(entryB.target, strength);
        }

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
        this.resultEl.textContent = '';
        this.resultEl.className = '';
        this.btnSame.disabled = false;
        this.btnDiff.disabled = false;
        this.updateScore();
    }

    answer(saidSame) {
        if (!this.current || this.btnSame.disabled) return;
        this.btnSame.disabled = true;
        this.btnDiff.disabled = true;
        this.score.asked++;
        const correct = (saidSame === this.current.isSame);
        if (correct) this.score.correct++;

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

        // 選択肢の色付け: 正解を緑、選んだ誤答を赤にして全て無効化
        [...this.choicesEl.children].forEach(b => {
            b.disabled = true;
            if (b.textContent === correctName) {
                b.style.borderColor = 'var(--neon-green)';
                b.style.color = 'var(--neon-green)';
            } else if (b === clickedBtn) {
                b.style.borderColor = 'var(--neon-red)';
                b.style.color = 'var(--neon-red)';
            }
        });

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
