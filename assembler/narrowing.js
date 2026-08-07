/**
 * 絞り込みモード（DESIGN_narrowing_mode.md の M1）
 *
 * 分子式と実験結果から構造を決めていく過程を、**候補が何通り残っているか**を見せながら操作させる。
 * 紙の上では絶対に見えない数字を出すのがこのモードの本体で、
 * 「どの実験を先に置くかで効きがまったく違う」ことを体験させる。
 *
 * M1 の範囲（設計書 §9）:
 *   ・制約パネル（分子式・不斉炭素の数・環の有無）
 *   ・条件カードを積む / 外す / 並べ替える
 *   ・各段の候補数と、直前から減った数。**0 のカードは灰色**
 *   ・候補は数と内訳だけ。1通りになったときだけ構造を描く
 *
 * M2 以降（マトリクス・ルート探索・入試問題）はここには入れない。
 *
 * ⚠ **候補を数えるのはアプリの仕事**。人は条件を選ぶだけにする（設計書 §1）。
 * ⚠ 列挙は重原子8個まで。C6H12O（211通り）だけ node で 5.5 秒かかるので
 *    `isomers-baked.json` に焼いて同梱してある（_解析/tools/bake-isomers.js が生成）。
 */

// ---- 分子式のプリセット ----
// 候補数が「多すぎず・少なすぎず」のものを選ぶ。数が難易度そのものになる（設計書 §10 の梯子）
const NARROW_FORMULAS = [
    { key: 'C3H6O', label: 'C3H6O', elements: ['C', 'C', 'C', 'O'], h: 6, hint: '神奈川大 2021-3 と同じ。エノールの扱いが効く' },
    { key: 'C4H10O', label: 'C4H10O', elements: ['C', 'C', 'C', 'C', 'O'], h: 10, hint: 'アルコール4種とエーテル3種' },
    { key: 'C5H12O', label: 'C5H12O', elements: ['C', 'C', 'C', 'C', 'C', 'O'], h: 12, hint: 'アルコールだけで8種' },
    { key: 'C5H10O', label: 'C5H10O', elements: ['C', 'C', 'C', 'C', 'C', 'O'], h: 10, hint: '不飽和度1。環・C=C・C=O の3択が出る' },
    { key: 'C6H12O', label: 'C6H12O', elements: ['C', 'C', 'C', 'C', 'C', 'C', 'O'], h: 12, baked: true, hint: '東大 2021 前期1I と同じ。211通りから始まる' },
    { key: 'C4H8O2', label: 'C4H8O2', elements: ['C', 'C', 'C', 'C', 'O', 'O'], h: 8, hint: 'エステルとカルボン酸が混ざる' },
];

// ---- 条件カード ----
// 文言は**実験の言い方**にする。裏に「＝ 何を言っているか」を出す（設計書 §5）。
// 実験と判定の対応を覚えるのがこのモードの副産物。
// row / cell … **マトリクス（M2）でどの行のどの印になるか**。
// 紙の答案が作っていた表（行が性質・列が化合物）をそのまま画面にするために、
// カードの側に「自分は表のどこを埋めるのか」を持たせる。カードを積むとセルが埋まる。
const NARROW_CARDS = [
    { id: 'na', say: 'ナトリウムを加えると水素が発生した', mean: '−OH をもつ', row: '−OH', cell: '○', test: (m) => NW.hydroxy(m) },
    { id: 'na-no', say: 'ナトリウムを加えても変化がなかった', mean: '−OH をもたない', row: '−OH', cell: '×', test: (m) => !NW.hydroxy(m) },
    { id: 'ox1', say: '酸化するとアルデヒドが得られた', mean: '第一級アルコール', row: 'アルコールの級', cell: '1級', test: (m) => NW.groups(m).includes('alcohol1') },
    { id: 'ox2', say: '酸化するとケトンが得られた', mean: '第二級アルコール', row: 'アルコールの級', cell: '2級', test: (m) => NW.groups(m).includes('alcohol2') },
    { id: 'ox3', say: '酸化されなかった', mean: '第三級アルコール', row: 'アルコールの級', cell: '3級', test: (m) => NW.groups(m).includes('alcohol3') },
    { id: 'iodo', say: 'ヨウ素と水酸化ナトリウムで黄色の沈殿が生じた', mean: 'ヨードホルム陽性（CH3-CO- か CH3-CH(OH)-）', row: 'ヨードホルム', cell: '○', test: (m) => NW.iodoform(m) },
    { id: 'iodo-no', say: 'ヨウ素と水酸化ナトリウムでは沈殿しなかった', mean: 'ヨードホルム陰性', row: 'ヨードホルム', cell: '×', test: (m) => !NW.iodoform(m) },
    { id: 'silver', say: '銀鏡反応を示した', mean: 'アルデヒド', row: 'アルデヒド', cell: '○', test: (m) => NW.groups(m).includes('aldehyde') },
    { id: 'silver-no', say: '銀鏡反応を示さなかった', mean: 'アルデヒドでない', row: 'アルデヒド', cell: '×', test: (m) => !NW.groups(m).includes('aldehyde') },
    { id: 'br2', say: '臭素水を脱色した', mean: '炭素間二重結合をもつ', row: 'C=C', cell: '○', test: (m) => NW.groups(m).includes('cc_double') },
    { id: 'br2-no', say: '臭素水を脱色しなかった', mean: '炭素間二重結合をもたない', row: 'C=C', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') },
    { id: 'h2-no', say: '水素を付加しなかった', mean: '不飽和結合をもたない（＝不飽和度は環のぶん）', row: '不飽和結合', cell: '×', test: (m) => !NW.groups(m).includes('cc_double') && !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    { id: 'ether', say: '加水分解されず、ナトリウムとも反応しなかった', mean: 'エーテル', row: 'エーテル', cell: '○', test: (m) => NW.groups(m).includes('ether') },
    { id: 'carbonyl-no', say: '赤外吸収でカルボニル基が見られなかった', mean: 'C=O をもたない', row: 'C=O', cell: '×', test: (m) => !NW.groups(m).includes('ketone') && !NW.groups(m).includes('aldehyde') },
    // 環の大きさ（設計書 §5「骨格」）。東大 2021 前期1I の問イ「四員環をもつもの」がこれで、
    // **実験だけでは 3 通りまでしか絞れず、ここで初めて 1 つに決まる**
    { id: 'ring3', say: '三員環をもつ', mean: '3員環', row: '環の大きさ', cell: '3員', test: (m) => { const c = NW.ring(m); return !!c && c.length === 3; } },
    { id: 'ring4', say: '四員環をもつ', mean: '4員環', row: '環の大きさ', cell: '4員', test: (m) => { const c = NW.ring(m); return !!c && c.length === 4; } },
    { id: 'ring5', say: '五員環をもつ', mean: '5員環', row: '環の大きさ', cell: '5員', test: (m) => { const c = NW.ring(m); return !!c && c.length === 5; } },
    { id: 'ring6', say: '六員環をもつ', mean: '6員環', row: '環の大きさ', cell: '6員', test: (m) => { const c = NW.ring(m); return !!c && c.length === 6; } },
];
// 表の行の並び。カードに出てこない行は出さない
const NARROW_ROWS = ['−OH', 'アルコールの級', 'C=O', 'アルデヒド', 'C=C', '不飽和結合', 'エーテル', 'ヨードホルム', '環の大きさ'];

/** 述語で使う小道具。chemistry.js の関数をそのまま使う（新しい化学ロジックは書かない） */
const NW = {
    groups(m) {
        if (!m._nwGroups) {
            try { m._nwGroups = findFunctionalGroups(m).map((x) => x.type || x.name); } catch (e) { m._nwGroups = []; }
        }
        return m._nwGroups;
    },
    ring(m) {
        if (m._nwRing === undefined) m._nwRing = findAnyCycle(m) || null;
        return m._nwRing;
    },
    /**
     * −OH をもつか（ナトリウムと反応するか）。
     *
     * ⚠ **エノールを数え落とさないこと。** `findFunctionalGroups` は C=C に直結した −OH を
     * `alcohol1/2/3` ではなく `enol` として返すので、`startsWith('alcohol')` だけで見ると
     * エノールが「−OH をもたない」側に落ちる。エノールにも −OH はあるのでナトリウムとは反応する。
     * 神奈川大 2021-3 で、候補が 1 通りに決まるべきところが 3 通り残って気づいた。
     */
    hydroxy(m) {
        const g = NW.groups(m);
        return g.some((x) => x.startsWith('alcohol')) || g.includes('enol');
    },
    chiral(m) {
        if (m._nwChiral === undefined) m._nwChiral = m.atoms.filter((a) => a.element === 'C' && m.isAsymmetricCarbon(a.id)).length;
        return m._nwChiral;
    },
    // ヨードホルム陽性 ＝ CH3-CO- または CH3-CH(OH)- を実際に探す。
    // ⚠ メタノールとホルムアルデヒドを陽性にしないこと（moves.json の注意書き）
    iodoform(m) {
        return m.atoms.some((a) => {
            if (a.element !== 'C' || m.getFreeValency(a.id) !== 3) return false;
            const nb = m.getNeighbors(a.id);
            if (nb.length !== 1) return false;
            const c = nb[0].atom;
            if (c.element !== 'C') return false;
            const isCarbonyl = m.getNeighbors(c.id).some((n) => n.atom.element === 'O' && n.type === 2);
            const isCarbinol = m.getFreeValency(c.id) >= 1
                && m.getNeighbors(c.id).some((n) => n.atom.element === 'O' && n.type === 1 && m.getFreeValency(n.atom.id) === 1);
            return isCarbonyl || isCarbinol;
        });
    },
    /** 候補の内訳ラベル。「どんな部品でできているか」でまとめる（設計書 §8 の配分カードにあたる） */
    partsLabel(m) {
        const g = NW.groups(m);
        const parts = [];
        if (NW.ring(m)) parts.push(`${NW.ring(m).length}員環`);
        if (g.includes('cc_double')) parts.push('C=C');
        if (g.includes('aldehyde')) parts.push('アルデヒド');
        if (g.includes('ketone')) parts.push('ケトン');
        if (g.includes('ether')) parts.push('エーテル');
        const alc = g.find((x) => x.startsWith('alcohol'));
        if (alc) parts.push({ alcohol1: '第一級 −OH', alcohol2: '第二級 −OH', alcohol3: '第三級 −OH' }[alc] || '−OH');
        return parts.join(' ＋ ') || '飽和・官能基なし';
    },
};

class NarrowingMode {
    constructor(game) {
        this.game = game;
        this.modal = document.getElementById('narrowing-modal');
        if (!this.modal) return;
        this.formulaKey = 'C4H10O';
        // noEnol は**既定でオン**。列挙エンジンはエノール（C=C に −OH が直結した形）も作るが、
        // 高校化学では「ビニルアルコールは不安定ですぐアセトアルデヒドになる」と扱うので答えにならない。
        // 切れるようにしてあるのは、**なぜ除くのかを説明する材料になる**から（P14-M1b）
        this.constraints = { chiral: '', ring: '', noEnol: true };
        // M2: 化合物ごとに1列。入試の構造決定は A〜F が並ぶのが普通で、
        // 1つの候補集合を絞る形では実物に合わない（設計書 §1・§4）
        this.columns = [{ name: 'A', stack: [] }];
        this.active = 0;
        this.pool = null;         // 制約をかけたあとの候補（Molecule の配列）。**全列で共有**
        this.baked = null;        // isomers-baked.json
        this.log = [];            // 操作ログ。op 単位で貯める（設計書 §10）

        const btn = document.getElementById('btn-narrowing');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-nw-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-nw-reset').addEventListener('click', () => { this.col().stack = []; this.record('op.card', 'reset'); this.render(); });
        document.getElementById('btn-nw-log').addEventListener('click', () => this.dumpLog());
        document.getElementById('btn-nw-add-col').addEventListener('click', () => this.addColumn());

        const sel = document.getElementById('nw-formula');
        // ⚠ ヒントを option の文言に入れない。**select の幅は最長の option で決まる**ので、
        //    狭い画面でモーダルごと横に溢れる（実測 280px 幅で 369px になった）。別行に出す
        NARROW_FORMULAS.forEach((f) => {
            const o = document.createElement('option');
            o.value = f.key;
            o.textContent = f.label;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => {
            this.formulaKey = sel.value;
            // 分子式が変われば全列の前提が変わる。**列は残して中身だけ空にする**
            // （A〜F という並びは問題文の側の話で、分子式とは独立）
            this.columns.forEach((c) => { c.stack = []; });
            this.pool = null;
            this.record('op.constraints', `formula=${sel.value}`);
            this.render();
        });
        ['nw-chiral', 'nw-ring'].forEach((id) => {
            document.getElementById(id).addEventListener('change', (e) => {
                this.constraints[id === 'nw-chiral' ? 'chiral' : 'ring'] = e.target.value;
                this.pool = null;
                this.record('op.constraints', `${id}=${e.target.value}`);
                this.render();
            });
        });
        document.getElementById('nw-enol').addEventListener('change', (e) => {
            this.constraints.noEnol = e.target.checked;
            this.pool = null;
            this.record('op.constraints', `noEnol=${e.target.checked}`);
            this.render();
        });
    }

    open() {
        this.modal.classList.remove('hidden');
        // 画面を状態に合わせ直す。閉じている間に外から状態を変えられても食い違わないようにする
        document.getElementById('nw-formula').value = this.formulaKey;
        document.getElementById('nw-chiral').value = this.constraints.chiral;
        document.getElementById('nw-ring').value = this.constraints.ring;
        document.getElementById('nw-enol').checked = this.constraints.noEnol;
        this.render();
    }

    col() { return this.columns[this.active] || this.columns[0]; }

    addColumn() {
        // A・B・C… と順に振る。26列を超えることは実問題では無い（最大でも A〜J 程度）
        const used = new Set(this.columns.map((c) => c.name));
        let name = 'A';
        for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.has(n)) { name = n; break; } }
        this.columns.push({ name, stack: [] });
        this.active = this.columns.length - 1;
        this.record('op.matrix', `+col:${name}`);
        this.render();
    }

    removeColumn(i) {
        if (this.columns.length <= 1) return;   // 列は最低1つ残す
        this.record('op.matrix', `-col:${this.columns[i].name}`);
        this.columns.splice(i, 1);
        if (this.active >= this.columns.length) this.active = this.columns.length - 1;
        this.render();
    }

    record(op, detail) {
        this.log.push({ t: Date.now(), op, detail, col: this.col().name, stack: this.col().stack.join('>') });
    }

    /** ログを JSON で出す。M1 では見るだけ。**診断が効くかは実データでしか確かめられない**ので最初から貯める */
    dumpLog() {
        const box = document.getElementById('nw-log-out');
        box.textContent = JSON.stringify(this.log, null, 1);
        box.classList.toggle('hidden', false);
    }

    formula() { return NARROW_FORMULAS.find((f) => f.key === this.formulaKey); }

    /** 焼いた JSON から Molecule を組み立て直す */
    fromBaked(rec) {
        const m = new Molecule();
        const ids = rec.e.split(',').map((el) => m.addAtom(el, 0, 0).id);
        rec.b.forEach(([i, j, t]) => m.addBond(ids[i], ids[j], t));
        return m;
    }

    /** 制約をかけた候補集合をつくる。制約は「候補集合の定義」で、カードとは別物（設計書 §2） */
    async buildPool() {
        if (this.pool) return this.pool;
        const f = this.formula();
        let list;
        if (f.baked) {
            if (!this.baked) {
                const res = await fetch(`isomers-baked.json?v=${window.APP_VERSION || ''}`, { cache: 'no-cache' });
                this.baked = (await res.json()).isomers;
            }
            list = (this.baked[f.key] || []).map((r) => this.fromBaked(r));
        } else {
            const r = enumerateConstitutionalIsomers(f.elements, f.h, 20000000);
            list = r.isomers;
        }
        this.all = list.length;
        // エノールを先に落とす。**他の制約より前にかける**のは、これが「そもそも候補に入らない」
        // 種類の除外だから（不斉炭素の数のような、問題文が言っている条件とは階層が違う）
        this.enolCount = list.filter((m) => NW.groups(m).includes('enol')).length;
        if (this.constraints.noEnol) list = list.filter((m) => !NW.groups(m).includes('enol'));
        if (this.constraints.chiral !== '') list = list.filter((m) => NW.chiral(m) === +this.constraints.chiral);
        if (this.constraints.ring === 'yes') list = list.filter((m) => !!NW.ring(m));
        if (this.constraints.ring === 'no') list = list.filter((m) => !NW.ring(m));
        this.pool = list;
        return list;
    }

    toggleCard(id) {
        const s = this.col().stack;
        const i = s.indexOf(id);
        if (i >= 0) s.splice(i, 1); else s.push(id);
        this.record('op.card', (i >= 0 ? '-' : '+') + id);
        this.render();
    }

    move(id, dir) {
        const s = this.col().stack;
        const i = s.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= s.length) return;
        [s[i], s[j]] = [s[j], s[i]];
        this.record('op.reorder', `${id}:${i}->${j}`);
        this.render();
    }

    /** ある列に積んだカードを順にかけたときの、各段の残り候補 */
    trace(stack, pool) {
        let cur = pool;
        const rows = stack.map((id) => {
            const card = NARROW_CARDS.find((c) => c.id === id);
            const before = cur.length;
            cur = cur.filter(card.test);
            return { id, before, after: cur.length, drop: before - cur.length };
        });
        return { rows, left: cur };
    }

    /**
     * ルート探索（M3・設計書 §6）。**積んだカードだけ**を対象にする。
     *
     * 条件は絞り込みなので**かける順番を変えても最後の候補集合は同じ**（フィルタは可換）。
     * 順番が効くのは途中の候補数だけ。だから2段に分けて調べる。
     *   1. どの部分集合で目標に届くか → 極小のものが「可能なルート」
     *   2. その集合をどの順でかけると速く減るか → 各段で最も減るものを選ぶ（貪欲）
     *
     * カードが n 枚なら 2ⁿ 通りの総当たり。実問題の実験は多くて8個なので実時間で終わる。
     * ⚠ **n が大きいと候補数の計算が n×2ⁿ 回走る**ので、上限を切って探索そのものを諦める
     * （「調べませんでした」と出すほうが、黙って固まるよりよい）。
     *
     * 試作は `_解析/tools/search-routes.js`。判定の名前と意味をそこから写している。
     */
    searchRoutes(stack, pool) {
        const n = stack.length;
        if (!n) return null;
        if (n > 12) return { tooMany: true, n };            // 2¹² = 4096 が実用上の上限
        const cards = stack.map((id) => NARROW_CARDS.find((c) => c.id === id));
        // 各カードが単独で残す集合を先に作る（同じ判定を何度も走らせない）
        const keep = cards.map((c) => pool.map((m) => c.test(m)));
        const countOf = (mask) => {
            let k = 0;
            for (let i = 0; i < pool.length; i++) {
                let ok = true;
                for (let b = 0; b < n; b++) if ((mask >> b) & 1) { if (!keep[b][i]) { ok = false; break; } }
                if (ok) k++;
            }
            return k;
        };
        const bits = (m) => { const r = []; for (let b = 0; b < n; b++) if ((m >> b) & 1) r.push(b); return r; };
        const FULL = (1 << n) - 1;
        const fullCount = countOf(FULL);
        // 目標は「1通り」ではなく **いま実際に到達している数**。
        // 1通りに届かない積み方（東大は実験だけでは3通りまでしか絞れない）でも
        // 「同じところへ、もっと少ない手で行けたか」は意味のある問いなので、それを見る。
        // こうすると minimal が空になることも無い（全部使えば必ず届く）
        const goal = fullCount;

        // 目標に届く部分集合のうち極小のもの（どれか1つ外すと届かなくなる）
        const reach = [];
        for (let mask = 0; mask <= FULL; mask++) if (countOf(mask) <= goal) reach.push(mask);
        const minimal = reach.filter((m) => bits(m).every((b) => countOf(m & ~(1 << b)) > goal));
        minimal.sort((a, b) => bits(a).length - bits(b).length);

        // かける順は貪欲（各段でいちばん減るものを選ぶ）
        const order = (mask) => {
            const rest = bits(mask);
            let cur = 0; let prev = pool.length;
            const steps = [];
            while (rest.length) {
                let best = null; let bestC = Infinity;
                rest.forEach((b) => { const k = countOf(cur | (1 << b)); if (k < bestC) { bestC = k; best = b; } });
                cur |= (1 << best);
                rest.splice(rest.indexOf(best), 1);
                steps.push({ id: cards[best].id, left: bestC, drop: prev - bestC });
                prev = bestC;
            }
            return steps;
        };

        // 同値な条件（残す集合がまったく同じ）。先に出たほうを代表にする
        const sig = keep.map((k) => k.map((v) => (v ? '1' : '0')).join(''));
        const dupOf = {};
        for (let b = 0; b < n; b++) for (let a = 0; a < b; a++) if (sig[a] === sig[b] && dupOf[b] === undefined) dupOf[b] = a;

        const used = new Set(minimal.flatMap(bits));
        const kind = (b) => {
            if (countOf(1 << b) === pool.length) return ['情報ゼロ', '単独でかけても1つも減らない。制約から自動的に満たされている'];
            if (dupOf[b] !== undefined) return ['重複', `「${cards[dupOf[b]].mean}」と残す集合が完全に同じ。どちらか一方でよい`];
            if (countOf(FULL & ~(1 << b)) === fullCount) return ['冗長', '他を全部使うなら、これを外しても結果が変わらない'];
            if (minimal.length && minimal.every((m) => (m >> b) & 1)) return ['必須', 'どのルートにも入る。外すと届かない'];
            if (used.has(b)) return ['代替あり', 'ルートによって使ったり使わなかったり'];
            return ['使わなくてよい', 'どの極小ルートにも入らない。あっても手数が増えるだけ'];
        };
        const ORDER = { 必須: 0, 代替あり: 1, 使わなくてよい: 2, 冗長: 3, 重複: 4, 情報ゼロ: 5 };
        const roles = cards.map((c, b) => ({ id: c.id, mean: c.mean, alone: countOf(1 << b), kind: kind(b) }))
            .sort((a, x) => ORDER[a.kind[0]] - ORDER[x.kind[0]] || a.alone - x.alone);

        return { n, fullCount, routes: minimal.map(order), roles };
    }

    async render() {
        const list = await this.buildPool();
        const cardById = Object.fromEntries(NARROW_CARDS.map((c) => [c.id, c]));

        // 全列ぶんを引き直す。**順番を変えると全部引き直される**のがこのモードの見どころ
        const traces = this.columns.map((c) => this.trace(c.stack, list));
        const { rows } = traces[this.active];
        const cur = traces[this.active].left;

        this.renderTabs(traces);
        this.renderMatrix(traces);

        document.getElementById('nw-hint').textContent = this.formula().hint;
        // エノールの除外は「制約」とひとまとめにせず、独立した段として見せる。
        // **なぜ候補から消えたのか**が分からないと、数が合わないときに自分の数え間違いを疑ってしまう
        const afterEnol = this.constraints.noEnol ? this.all - this.enolCount : this.all;
        const seg = [`${this.formula().label} の構造異性体 ${this.all} 通り`];
        if (this.constraints.noEnol && this.enolCount) seg.push(`エノール ${this.enolCount} 種を除いて ${afterEnol} 通り`);
        if (list.length !== afterEnol) seg.push(`制約で ${list.length} 通り`);
        document.getElementById('nw-start').textContent = seg.join(' → ');

        const warn = document.getElementById('nw-enol-note');
        warn.textContent = !this.constraints.noEnol && this.enolCount
            ? `⚠ エノール ${this.enolCount} 種を候補に入れています。C=C に −OH が直結した形は単離できず、`
              + 'すぐカルボニルに変わるので「化合物A」にはなれません。'
              + '判定は正しく働きます（−OH をもつのでナトリウムとは反応します）が、答えの候補としては数えすぎになります'
            : '';
        warn.classList.toggle('hidden', !warn.textContent);

        // 積んだカード（**いま選んでいる列のぶんだけ**）
        const stackEl = document.getElementById('nw-stack');
        stackEl.innerHTML = rows.length ? ''
            : `<p class="nw-empty">下のカードを押して <b>化合物 ${this.col().name}</b> に積んでください。`
              + '<b>積む順番で効きが変わります。</b>複数の化合物を追うときは「＋ 化合物」で列を足します。</p>';
        rows.forEach((r, i) => {
            const c = cardById[r.id];
            const div = document.createElement('div');
            div.className = 'nw-row' + (r.drop === 0 ? ' nw-dead' : '');
            div.innerHTML = `<span class="nw-n">${i + 1}</span>
                <span class="nw-say">${c.say}<em>＝ ${c.mean}</em></span>
                <span class="nw-drop">${r.drop === 0 ? '減らない' : '−' + r.drop}</span>
                <span class="nw-left">${r.after}</span>`;
            const ctrl = document.createElement('span');
            ctrl.className = 'nw-ctrl';
            [['↑', -1], ['↓', 1]].forEach(([t, d]) => {
                const b = document.createElement('button');
                b.textContent = t;
                b.addEventListener('click', () => this.move(r.id, d));
                ctrl.appendChild(b);
            });
            const x = document.createElement('button');
            x.textContent = '×';
            x.addEventListener('click', () => this.toggleCard(r.id));
            ctrl.appendChild(x);
            div.appendChild(ctrl);
            stackEl.appendChild(div);
        });

        // 選べるカード
        const palette = document.getElementById('nw-palette');
        palette.innerHTML = '';
        NARROW_CARDS.forEach((c) => {
            const b = document.createElement('button');
            b.className = 'nw-card' + (this.col().stack.includes(c.id) ? ' on' : '');
            b.innerHTML = `${c.say}<em>＝ ${c.mean}</em>`;
            b.addEventListener('click', () => this.toggleCard(c.id));
            palette.appendChild(b);
        });

        this.renderResult(cur, list);
    }

    /** 列（化合物）のタブ。いま何を追っているかと、各列の残り候補数を出す */
    renderTabs(traces) {
        const el = document.getElementById('nw-tabs');
        el.innerHTML = '';
        this.columns.forEach((c, i) => {
            const n = traces[i].left.length;
            const b = document.createElement('button');
            b.className = 'nw-tab' + (i === this.active ? ' on' : '') + (n === 1 ? ' done' : '') + (n === 0 ? ' zero' : '');
            b.innerHTML = `${c.name}<em>${n}</em>`;
            b.title = n === 1 ? `${c.name} は1通りに決まりました` : `${c.name} の残り候補 ${n} 通り`;
            b.addEventListener('click', () => { this.active = i; this.record('op.matrix', `col:${c.name}`); this.render(); });
            el.appendChild(b);
            if (this.columns.length > 1) {
                const x = document.createElement('button');
                x.className = 'nw-tab-x';
                x.textContent = '×';
                x.title = `化合物 ${c.name} の列を消す`;
                x.addEventListener('click', () => this.removeColumn(i));
                el.appendChild(x);
            }
        });
    }

    /**
     * マトリクス（設計書 §4）。行が性質、列が化合物。
     *
     * **空のセルが「まだ決まっていないこと」を示す**のがこの表の値打ちで、
     * どこを埋めれば進むかが見える。線形にたどるより取りこぼしが減る。
     * 紙の答案（東大 2021 前期1I）が実際に作っていた表そのもの。
     */
    renderMatrix(traces) {
        const el = document.getElementById('nw-matrix');
        const used = NARROW_ROWS.filter((r) => this.columns.some((c) => c.stack.some((id) => NARROW_CARDS.find((x) => x.id === id).row === r)));
        // 1列だけで、まだ何も積んでいないうちは表を出さない（空の表は情報がゼロ）
        if (!used.length) { el.innerHTML = ''; el.classList.add('hidden'); return; }
        el.classList.remove('hidden');

        // セルの値。**同じ行に後から積んだカードが勝つ**（積み直しで上書きできる）
        const cellOf = (col, row) => {
            let v = '';
            col.stack.forEach((id) => { const c = NARROW_CARDS.find((x) => x.id === id); if (c.row === row) v = c.cell; });
            return v;
        };
        const th = (s, cls) => `<th${cls ? ` class="${cls}"` : ''}>${s}</th>`;
        const head = '<tr>' + th('') + this.columns.map((c, i) =>
            th(c.name, i === this.active ? 'on' : '')).join('') + '</tr>';
        const body = used.map((r) => '<tr>' + th(r, 'rowhead') + this.columns.map((c) => {
            const v = cellOf(c, r);
            return `<td class="${v ? 'set' : 'blank'}">${v || '・'}</td>`;
        }).join('') + '</tr>').join('');
        const foot = '<tr class="nw-foot">' + th('残り候補', 'rowhead') + traces.map((t) =>
            `<td class="${t.left.length === 1 ? 'one' : t.left.length === 0 ? 'zero' : ''}">${t.left.length}</td>`).join('') + '</tr>';
        el.innerHTML = `<table>${head}${body}${foot}</table>`
            + '<p class="nw-matrix-note">「・」はまだ決まっていない欄。<b>そこを埋める実験を探すのが次の一手。</b></p>';
    }

    /** 候補の見せ方は3段階（設計書 §8）。M1 は「数と内訳」まで。1通りのときだけ描く */
    renderResult(cur, pool) {
        const out = document.getElementById('nw-result');
        const svg = document.getElementById('nw-svg');
        svg.classList.add('hidden');

        // ルート探索は**2枚以上積んだら常に出す**。1通りに届いていなくても
        // 「同じところへもっと少ない手で行けたか」は意味のある問い（設計書 §6）
        if (this.col().stack.length >= 2 && cur.length > 0) this.renderRoutes(pool);
        else document.getElementById('nw-routes').classList.add('hidden');

        if (cur.length === 0) {
            out.innerHTML = '<p class="nw-zero"><b>候補が 0 になりました。</b>両立しない条件を積んでいます（「−OH をもつ」と「もたない」など）。</p>';
            return;
        }
        if (cur.length === 1) {
            out.innerHTML = '<p class="nw-one"><b>1通りに決まりました。</b></p>';
            svg.classList.remove('hidden');
            const m = cur[0];
            layoutMolecule(m);
            const idx = Object.fromEntries(m.atoms.map((a, i) => [a.id, i]));
            renderMoleculeIntoSvg(this.game, 'nw-svg', {
                atoms: m.atoms.map((a) => ({ element: a.element, x: a.x, y: a.y })),
                bonds: m.bonds.map((b) => ({ atom1Index: idx[b.atomId1], atom2Index: idx[b.atomId2], type: b.type })),
            }, false);
            this.record('op.solved', this.col().stack.join('>'));
            return;
        }
        // 内訳。同じ部品構成のものをまとめて数える
        const by = {};
        cur.forEach((m) => { const k = NW.partsLabel(m); by[k] = (by[k] || 0) + 1; });
        const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
        out.innerHTML = `<p class="nw-count">残り <b>${cur.length}</b> 通り</p>`
            + '<ul class="nw-parts">' + rows.map(([k, n]) => `<li><span>${k}</span><b>${n}</b></li>`).join('') + '</ul>';
    }

    /**
     * ルート探索の結果（M3）。1通りに決まったときだけ出す。
     *
     * ⚠ **「冗長」はこの化合物を決めるだけなら、の意味**（設計書 §6）。
     * 同じ実験が他の化合物には必須のことがあるので、この但し書きを画面から落とさない。
     */
    renderRoutes(pool) {
        const el = document.getElementById('nw-routes');
        const r = this.searchRoutes(this.col().stack, pool);
        el.classList.remove('hidden');
        if (!r) { el.classList.add('hidden'); return; }
        if (r.tooMany) {
            el.innerHTML = `<p class="nw-routes-head">カードが ${r.n} 枚あるので、他の解き方は調べませんでした（総当たりが重すぎます）。</p>`;
            return;
        }
        const meanOf = (id) => (NARROW_CARDS.find((c) => c.id === id) || {}).mean || id;
        const mine = this.col().stack.length;
        const best = r.routes.length ? r.routes[0].length : mine;
        const goal = r.fullCount === 1 ? '1通り' : `${r.fullCount} 通り`;

        const head = r.routes.length > 1
            ? `<p class="nw-routes-head"><b>他にも解き方があります。</b>${goal}に届く最小の組み合わせが <b>${r.routes.length} 通り</b>ありました`
              + `（いま積んでいるのは ${mine} 手、最短は <b>${best} 手</b>）。</p>`
            : `<p class="nw-routes-head">${goal}に届く最小の組み合わせは<b>1つだけ</b>でした`
              + `（いま ${mine} 手、最短 <b>${best} 手</b>）。この筋以外に道はありません。</p>`;

        const routes = r.routes.slice(0, 4).map((steps, i) => {
            const li = steps.map((s) => `<li><span>${meanOf(s.id)}</span><b>${s.left}</b><em>−${s.drop}</em></li>`).join('');
            return `<div class="nw-route"><h4>ルート${i + 1}（${steps.length} 手）${steps.length === best ? '<i>最短</i>' : ''}</h4><ol>${li}</ol></div>`;
        }).join('');
        const more = r.routes.length > 4 ? `<p class="nw-routes-more">…ほか ${r.routes.length - 4} 通り</p>` : '';

        const roles = r.roles.map((x) =>
            `<li class="k-${x.kind[0]}"><span>${x.mean}</span><b>${x.kind[0]}</b><em title="${x.kind[1]}">単独で ${x.alone} 通り</em></li>`).join('');

        el.innerHTML = head
            + `<div class="nw-routes-list">${routes}</div>${more}`
            + '<h4 class="nw-roles-head">積んだカードの性質</h4>'
            + `<ul class="nw-roles">${roles}</ul>`
            + '<p class="nw-routes-note">⚠「冗長」は<b>この化合物を決めるだけなら</b>の意味。'
            + '同じ実験が他の化合物には必須のことがあります。</p>';
    }
}

if (typeof window !== 'undefined') {
    window.NarrowingMode = NarrowingMode;
    window.NARROW_CARDS = NARROW_CARDS;
    window.NARROW_FORMULAS = NARROW_FORMULAS;
    window.NARROW_ROWS = NARROW_ROWS;
    window.NW = NW;
}
