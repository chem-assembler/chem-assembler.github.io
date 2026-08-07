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
];
// 表の行の並び。カードに出てこない行は出さない
const NARROW_ROWS = ['−OH', 'アルコールの級', 'C=O', 'アルデヒド', 'C=C', '不飽和結合', 'エーテル', 'ヨードホルム'];

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
        this.stack = [];          // 積んだカードの id（順番が意味を持つ）
        this.pool = null;         // 制約をかけたあとの候補（Molecule の配列）
        this.baked = null;        // isomers-baked.json
        this.log = [];            // 操作ログ。op 単位で貯める（設計書 §10）

        const btn = document.getElementById('btn-narrowing');
        if (btn) btn.addEventListener('click', () => this.open());
        document.getElementById('btn-nw-close').addEventListener('click', () => this.modal.classList.add('hidden'));
        document.getElementById('btn-nw-reset').addEventListener('click', () => { this.stack = []; this.record('op.constraints', 'reset'); this.render(); });
        document.getElementById('btn-nw-log').addEventListener('click', () => this.dumpLog());

        const sel = document.getElementById('nw-formula');
        // ⚠ ヒントを option の文言に入れない。**select の幅は最長の option で決まる**ので、
        //    狭い画面でモーダルごと横に溢れる（実測 280px 幅で 369px になった）。別行に出す
        NARROW_FORMULAS.forEach((f) => {
            const o = document.createElement('option');
            o.value = f.key;
            o.textContent = f.label;
            sel.appendChild(o);
        });
        sel.addEventListener('change', () => { this.formulaKey = sel.value; this.stack = []; this.pool = null; this.record('op.constraints', `formula=${sel.value}`); this.render(); });
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

    record(op, detail) {
        this.log.push({ t: Date.now(), op, detail, stack: this.stack.join('>') });
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
        const i = this.stack.indexOf(id);
        if (i >= 0) this.stack.splice(i, 1); else this.stack.push(id);
        this.record('op.card', (i >= 0 ? '-' : '+') + id);
        this.render();
    }

    move(id, dir) {
        const i = this.stack.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= this.stack.length) return;
        [this.stack[i], this.stack[j]] = [this.stack[j], this.stack[i]];
        this.record('op.reorder', `${id}:${i}->${j}`);
        this.render();
    }

    async render() {
        const list = await this.buildPool();
        const cardById = Object.fromEntries(NARROW_CARDS.map((c) => [c.id, c]));

        // 各段の残り候補。**順番を変えると全部引き直される**のがこのモードの見どころ
        let cur = list;
        const rows = this.stack.map((id) => {
            const before = cur.length;
            cur = cur.filter(cardById[id].test);
            return { id, before, after: cur.length, drop: before - cur.length };
        });

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

        // 積んだカード
        const stackEl = document.getElementById('nw-stack');
        stackEl.innerHTML = rows.length ? '' : '<p class="nw-empty">下のカードを押して積んでください。<b>積む順番で効きが変わります。</b></p>';
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
            b.className = 'nw-card' + (this.stack.includes(c.id) ? ' on' : '');
            b.innerHTML = `${c.say}<em>＝ ${c.mean}</em>`;
            b.addEventListener('click', () => this.toggleCard(c.id));
            palette.appendChild(b);
        });

        this.renderResult(cur);
    }

    /** 候補の見せ方は3段階（設計書 §8）。M1 は「数と内訳」まで。1通りのときだけ描く */
    renderResult(cur) {
        const out = document.getElementById('nw-result');
        const svg = document.getElementById('nw-svg');
        svg.classList.add('hidden');

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
            this.record('op.solved', this.stack.join('>'));
            return;
        }
        // 内訳。同じ部品構成のものをまとめて数える
        const by = {};
        cur.forEach((m) => { const k = NW.partsLabel(m); by[k] = (by[k] || 0) + 1; });
        const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
        out.innerHTML = `<p class="nw-count">残り <b>${cur.length}</b> 通り</p>`
            + '<ul class="nw-parts">' + rows.map(([k, n]) => `<li><span>${k}</span><b>${n}</b></li>`).join('') + '</ul>';
    }
}

if (typeof window !== 'undefined') {
    window.NarrowingMode = NarrowingMode;
    window.NARROW_CARDS = NARROW_CARDS;
    window.NARROW_FORMULAS = NARROW_FORMULAS;
    window.NW = NW;
}
