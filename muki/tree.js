// 色でみる無機化学 — 系統分離モード「型A: すべてのイオンを分ける」の画面
//
// DESIGN_separation.md §16-1・§16-2 に従う:
//   ・★ **机上論。⚠ 途中では何も返さない。並べ終えてから答え合わせ**
//   ・★ 画面は **ツリー**（枝と葉）。⚠ 容器が増えていく画面ではない
//   ・★ 置き方は2種類だけ —— **操作カードを枝へ／イオンカードを葉へ**
//
// 【⚠ ドラッグ＆ドロップにしなかった理由】
//   設計書 §16-2 のユーザー提案は「ドラッグアンドドロップ」だが、
//   ★ muki はスマホ前提で、HTML5 の drag&drop はタッチでは発火しない
//     （touchstart/touchmove を自前で拾い直すことになり、
//      スクロールとの取り合い・ゴースト表示・自動スクロールを全部書くことになる）。
//   ★ **「札をタップ → 置き先をタップ」の2段**にした。
//     ⚠ タップは指でもマウスでも同じ経路（click）で、回帰テストからも同じ経路で駆動できる。
//     ★ 置いた札をもう一度タップすると手札に戻る ＝ 取り消しも同じ作法で足りる。
//
// ⚠ 途中で「その置き方は違います」と言わない（§4-3「警告を出さない」）。
//   ★ 提出したときに、組んだ手順をそのまま走らせて、机上と実際を突き合わせる。

(function () {
    'use strict';

    var state = {
        mode: 'read',       // 'read'（操作は置いてある）／'build'（操作から組む）
        level: 'easy',      // ★ 難易度は学習者が選ぶ（型B と同じ。⚠ 段の切り方は模型が持つ）
        problem: null,
        seq: [],            // 枝に置かれた操作。⚠ 空の枝は null（★ 詰めない。葉の番号がずれる）
        sub: {},            // ★★ 沈殿側の札。{ 枝の番号: 札 }（2026-08-28）
        plan: {},           // 本人の机上。{ ionId: leafId }
        sel: null,          // いま選んでいる札 { type:'op'|'sub'|'ion', id }
        submitted: false,
        lastKey: null,      // ★ 直前に出した容器（⚠ 同じ容器を続けて出さないため）
        record: null        // ★ 型の鍵（⚠ 送信も保存もしない。持つだけ。§18-6 (3) と同じ作法）
    };

    var $ = function (id) { return document.getElementById(id); };

    function ionName(id) { var i = treeIon(id); return i ? i.name : id; }
    function ionFull(id) { var i = treeIon(id); return i ? i.name + '（' + i.jp + '）' : id; }
    function opShort(id) {
        if (TREE_OPS[id]) return TREE_OPS[id].short;
        if (TREE_SUBOPS[id]) return TREE_SUBOPS[id].short;
        return id;
    }
    function opSay(id) {
        if (TREE_OPS[id]) return TREE_OPS[id].say;
        if (TREE_SUBOPS[id]) return TREE_SUBOPS[id].say;
        return id;
    }
    function elJp(el) { return TREE_ELEMENT_JP[el] || el; }
    function levelOf(id) {
        return TREE_LEVELS.filter(function (l) { return l.id === id; })[0] || TREE_LEVELS[0];
    }

    // ---------------------------------------------------------------
    // 手札
    // ---------------------------------------------------------------
    function usedOps() { return state.seq.filter(function (o) { return !!o; }); }
    function placedIons() { return Object.keys(state.plan); }
    /** ★ いま組んである木（⚠ 置き場も葉の名前も、ここから出す。決め打ちしない） */
    function currentRun() { return treeRun(state.problem.ions, state.seq, state.sub); }

    function card(kind, id, main, sub) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'card ' + kind;
        b.setAttribute('data-' + kind, id);
        var m = document.createElement('span');
        m.textContent = main;
        b.appendChild(m);
        if (sub) {
            var s = document.createElement('span');
            s.className = 'sub';
            s.textContent = sub;
            b.appendChild(s);
        }
        return b;
    }

    function renderDecks() {
        var od = $('op-deck');
        od.textContent = '';
        // ⚠ やさしい段（イオンの行先を答える）では操作の手札を出さない。★ 枝はもう埋まっている
        if (state.mode === 'build') {
            state.problem.ops.forEach(function (o) {
                // ★ reuse の札（硫化水素）は置いても手札に残る
                //   ⚠ 教科書の手順は同じ札を2度通す（液性が違うから結果が違う）
                if (!TREE_OPS[o].reuse && usedOps().indexOf(o) >= 0) return;
                var b = card('op', o, TREE_OPS[o].short, TREE_OPS[o].say);
                b.disabled = state.submitted;
                b.className += (state.sel && state.sel.type === 'op' && state.sel.id === o) ? ' picked' : '';
                b.addEventListener('click', function () { pick('op', o); });
                od.appendChild(b);
            });
            // ★★ 沈殿側の札（⚠ 置き先が枝ではなく **沈殿**）。
            //   ⚠ 中身に合わせて配る枚数を変えない —— 変えると「熱湯が配られている ＝
            //     第1属に2つある」と読めてしまい、それ自体が解き筋のヒントになる
            (state.problem.subOps || []).forEach(function (o) {
                var b = card('sub', o, TREE_SUBOPS[o].short, TREE_SUBOPS[o].say);
                b.disabled = state.submitted;
                b.className += (state.sel && state.sel.type === 'sub' && state.sel.id === o) ? ' picked' : '';
                b.addEventListener('click', function () { pick('sub', o); });
                od.appendChild(b);
            });
        }
        var idk = $('ion-deck');
        idk.textContent = '';
        state.problem.ions.forEach(function (c) {
            if (placedIons().indexOf(c) >= 0) return;
            var b = card('ion', c, ionName(c));
            b.disabled = state.submitted;
            b.className += (state.sel && state.sel.type === 'ion' && state.sel.id === c) ? ' picked' : '';
            b.addEventListener('click', function () { pick('ion', c); });
            idk.appendChild(b);
        });
    }

    function pick(type, id) {
        if (state.submitted) return;
        if (state.sel && state.sel.type === type && state.sel.id === id) state.sel = null;
        else state.sel = { type: type, id: id };
        say(state.sel ? pickHint(type, id) : '');
        render();
    }

    function pickHint(type, id) {
        if (type === 'op') return '〔' + opShort(id) + '〕を、置きたい枝を押して置いてください。';
        // ★ 沈殿側の札は、置き先が枝ではなく **沈殿**
        if (type === 'sub') return '〔' + opShort(id) + '〕を、割りたい沈殿を押して置いてください。';
        return ionName(id) + ' を、行先の葉を押して置いてください。';
    }

    function say(msg) { $('hint').textContent = msg || ''; }

    // ---------------------------------------------------------------
    // ツリー
    // ---------------------------------------------------------------
    /**
     * ⚠⚠ 「沈殿だから置ける」と決め打ちしない（§20-4）。
     * ★ 置き場かどうかは **木の形**から出す —— 模型が数えた終端の一覧に居るかどうか。
     */
    function leafExists(leafId) {
        return treeLeafIds(currentRun()).indexOf(leafId) >= 0;
    }

    /** 葉が消えたら、そこに置いてあったイオンは手札に戻す */
    function dropOrphans() {
        Object.keys(state.plan).forEach(function (ionId) {
            if (!leafExists(state.plan[ionId])) delete state.plan[ionId];
        });
    }

    function placeOp(slot) {
        if (state.submitted || state.mode !== 'build') return;
        if (!state.sel || state.sel.type !== 'op') { say('先に操作の札を押してください。'); return; }
        state.seq[slot] = state.sel.id;
        state.sel = null;
        dropOrphans();
        say('');
        render();
    }

    function removeOp(slot) {
        if (state.submitted || state.mode !== 'build') return;
        state.seq[slot] = null;
        // ★ 枝が空けば、その沈殿ごと消える ＝ 沈殿側の札も置き場を失う
        delete state.sub[slot];
        dropOrphans();
        render();
    }

    /** ★★ 沈殿側の札を置く（⚠ 置き先は枝ではなく沈殿の節） */
    function placeSub(slot) {
        if (state.submitted || state.mode !== 'build') return;
        if (!state.sel || state.sel.type !== 'sub') return;
        state.sub[slot] = state.sel.id;
        state.sel = null;
        dropOrphans();
        say('');
        render();
    }

    function removeSub(slot) {
        if (state.submitted || state.mode !== 'build') return;
        delete state.sub[slot];
        dropOrphans();
        render();
    }

    function placeIon(leafId) {
        if (state.submitted) return;
        if (!state.sel || state.sel.type !== 'ion') { say('先にイオンの札を押してください。'); return; }
        // ★★ 1つの葉に入るイオンは1つだけ（単離が目的なので、そもそも2つ置く意味がない）。
        //   ⚠ すでに置いてあるものは手札に戻す ＝ 枠が中身で縦に伸びない
        Object.keys(state.plan).forEach(function (i) { if (state.plan[i] === leafId) delete state.plan[i]; });
        state.plan[state.sel.id] = leafId;
        state.sel = null;
        say('');
        render();
    }

    function removeIon(ionId) {
        if (state.submitted) return;
        delete state.plan[ionId];
        render();
    }

    /**
     * ★★★ 流れ図を **ディレクトリツリー**として組む（2026-08-28・ユーザー決定）。
     *
     * > ★ 「ディレクトリのツリーのようにすれば解決できるかなと考えていました」
     * > ★★ 「相は枠の形で表現できます」
     *
     * 【★★ 「脱出」で全部そろう】
     *   ・**主流は1本。**⚠ **インデントしない。**上から下へ一直線
     *   ・★ **脱出したものが1段下がる**（⚠ **沈殿でも溶液でも同じ規則**）
     *   ・★ **脱出しなかったほうが、主流を継ぐ**
     *   ⚠ ふつうは沈殿が溶液から脱出するが、★ 属の中の分離では **溶液のほうが沈殿から脱出する**
     *     （AgCl と PbCl₂ の沈殿に熱湯 → PbCl₂ が溶けて出ていく）。
     *   ★★ **向きが逆でも同じ規則で書ける ＝ この骨格は相に依らない。**
     *
     * 【★ 深さは *インデント* で表す。⚠⚠ 列を増やさない】
     *   ＝ 深さ2の問題（属の中の分離）が来ても、幅は 20px 増えるだけ。
     *   ⚠ 375px で列が入らない、という心配がそもそも起きない。
     *
     * 【★★ イオンを置けるのは「終端」だけ】（2026-08-27・ユーザー決定）
     *   ⚠⚠ **「沈殿だから置ける」と決め打ちしない。**★ 置けるかは **木の形**から出す
     *     —— 子を持たない節が終端であり、そこだけが置き場になる。
     *   ★ Ag⁺ と Pb²⁺ を含む沈殿は *子を持つ* ので置き場でなくなり、
     *     熱湯で割ったあとの2つが置き場になる。**この関数を直さずに済む。**
     *
     * @returns rows[] —— 1行 ＝ 1つの節、または1つの試薬
     *   { kind:'node', id, depth, phase:'sol'|'ppt', title, terminal, ions? }
     *   { kind:'edge', slot, opId, depth }
     */
    function flowRows() {
        var rows = [];
        var pending = [];       // ⚠ 次の試薬より前に出す「主流を継ぐ」行
        var mainTail = 'start'; // ★ いま主流の末端になっている節

        rows.push({
            kind: 'node', id: 'start', parent: null, depth: 0, phase: 'sol',
            title: 'この容器', ions: state.problem.ions
        });

        state.seq.forEach(function (opId, slot) {
            pending.forEach(function (r) { rows.push(r); mainTail = r.id; });
            pending = [];
            rows.push({ kind: 'edge', slot: slot, opId: opId, depth: 0 });
            if (!opId || !TREE_OPS[opId].splits) return;
            var lid = treeLeafId(slot);
            // ★ 脱出したもの（主流からは沈殿が脱出する）
            rows.push({
                kind: 'node', id: lid, parent: mainTail, depth: 1, phase: 'ppt',
                title: '沈殿', subSlot: slot
            });
            // ★★★ 沈殿側の枝（2026-08-28）—— ⚠ **同じ規則をもう一段深くで使うだけ**。
            //   ★ 属の中の分離では **溶液のほうが沈殿から脱出する**（向きが逆でも規則は同じ）。
            //   ⚠ 深さは **インデント**で表す ＝ 列は増えない（§20-3）。
            if (state.sub[slot]) {
                rows.push({ kind: 'edge', slot: slot, opId: state.sub[slot], depth: 1, isSub: true });
                rows.push({
                    kind: 'node', id: treeSubLeafId(slot, 's'), parent: lid, depth: 2,
                    phase: 'sol', title: '溶けた液'
                });
                rows.push({
                    kind: 'node', id: treeSubLeafId(slot, 'p'), parent: lid, depth: 1,
                    phase: 'ppt', title: '沈殿の残り'
                });
            }
            // ★ 脱出しなかったほうが主流を継ぐ。⚠ 次の試薬の直前に出す
            //   （最後まで試薬が来なければ、下の「最後のろ液」が引き受ける）
            pending.push({
                kind: 'node', id: 'v' + slot, parent: mainTail, depth: 0,
                phase: 'sol', title: 'ろ液'
            });
        });

        rows.push({
            kind: 'node', id: TREE_FINAL_LEAF, parent: mainTail, depth: 0, phase: 'sol',
            title: '最後のろ液'
        });

        // ★★ **終端は木の形から出す**（§20-4・⚠ 「沈殿だから置ける」と決め打ちしない）——
        //   子を持たない節だけが置き場になる。★ 沈殿を割れば、その沈殿は置き場でなくなる。
        var hasChild = {};
        rows.forEach(function (r) { if (r.parent) hasChild[r.parent] = 1; });
        rows.forEach(function (r) { if (r.kind === 'node') r.terminal = !hasChild[r.id]; });
        return rows;
    }

    /** 1つの節を1行で描く。★ 相は **枠の形** —— ▢ ＝ 沈殿 ／ ⬭ ＝ 溶液（⚠ 色だけで区別しない） */
    function nodeRow(r) {
        var placedIon = null;
        if (r.terminal) {
            Object.keys(state.plan).forEach(function (i) { if (state.plan[i] === r.id) placedIon = i; });
        }
        // ★★ 沈殿側の札を置ける節か（⚠ 「割る」相手は沈殿。★ まだ割っていないものだけ）
        var canSplit = r.subSlot != null && !state.sub[r.subSlot] &&
            state.mode === 'build' && !state.submitted;
        // ⚠⚠ 途中の節には置かせない（★ 終端だけが答案欄。どこを終端にするか自体が答案）
        var pressable = r.terminal || canSplit;
        var el = document.createElement(pressable ? 'button' : 'div');
        el.className = 'row node ' + r.phase + (r.terminal ? ' terminal' : ' inner');
        el.setAttribute('data-node', r.id);
        el.setAttribute('data-d', String(r.depth));
        // ★ 節のインデントは、その節の深さそのもの（⚠ 主流は 0 ＝ 左端に立つ）
        el.setAttribute('data-i', String(r.depth));
        el.style.setProperty('--i', String(r.depth));
        if (pressable) {
            el.type = 'button';
            el.disabled = state.submitted;
        }
        if (canSplit) {
            el.className += ' splittable' +
                (state.sel && state.sel.type === 'sub' ? ' can' : '');
            el.setAttribute('data-split', String(r.subSlot));
        }
        if (r.terminal) {
            el.className += ' slot leaf ' + (placedIon ? 'set' : 'empty') +
                (!placedIon && state.sel && state.sel.type === 'ion' ? ' can' : '');
            el.setAttribute('data-leaf', r.id);
            if (placedIon) el.setAttribute('data-ion', placedIon);
        }
        if (pressable) {
            el.addEventListener('click', function () {
                // ★ 沈殿側の札を持っているなら、まずそれを置く（⚠ 終端でも同じ ——
                //   割れば終端でなくなる、という順の入れ替わりがそのまま操作になる）
                if (canSplit && state.sel && state.sel.type === 'sub') { placeSub(r.subSlot); return; }
                if (!r.terminal) return;
                if (placedIon && !(state.sel && state.sel.type === 'ion')) removeIon(placedIon);
                else placeIon(r.id);
            });
        }

        var t = document.createElement('span');
        t.className = 'node-title';
        t.textContent = r.title;
        el.appendChild(t);

        if (r.ions) {
            var ions = document.createElement('span');
            ions.className = 'ions';
            ions.id = 'beaker-ions';
            ions.textContent = r.ions.map(ionName).join('　');
            el.appendChild(ions);
        }
        if (r.terminal) {
            var v = document.createElement('span');
            v.className = 'leaf-val';
            v.textContent = placedIon ? ionName(placedIon) : 'イオンを置く';
            el.appendChild(v);
        }
        return el;
    }

    /**
     * 1つの試薬を1行で描く。
     * ★★ **試薬は、それを加える節より1段下げる**（2026-08-28・ユーザーの図のとおり）——
     *   ⚠ **その試薬で脱出した節と、同じ段にそろう**（`＋塩酸` と `├─ ▢ 沈殿` が並ぶ）。
     *   ★ 左端に立っているのは主流の節だけになり、脇のものと区別が付く。
     */
    function edgeRow(r) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'row edge slot ' + (r.isSub ? 'subbranch' : 'branch') +
            (r.opId ? ' set' : ' empty') +
            (state.mode === 'read' ? ' locked' : '') +
            (!r.opId && state.sel && state.sel.type === 'op' ? ' can' : '');
        b.setAttribute('data-slot', String(r.slot));
        if (r.isSub) b.setAttribute('data-subslot', String(r.slot));
        b.setAttribute('data-d', String(r.depth));
        b.setAttribute('data-i', String(r.depth + 1));
        b.style.setProperty('--i', String(r.depth + 1));
        b.disabled = state.submitted || state.mode === 'read';
        var n = document.createElement('span');
        n.className = 'op-name';
        // ⚠ 詳しい操作（say）は行に出さない —— 1節1行を守るため。
        //   ★ 手札の札と、答え合わせの各手の見出しに出る（そこは幅がある）
        n.textContent = r.opId ? '＋ ' + opShort(r.opId) : '＋ 操作を置く';
        b.appendChild(n);
        b.addEventListener('click', function () {
            if (r.isSub) { removeSub(r.slot); return; }
            if (r.opId) removeOp(r.slot); else placeOp(r.slot);
        });
        return b;
    }

    function renderTree() {
        var flow = $('flow');
        flow.textContent = '';
        var rows = flowRows();
        var maxDepth = 0;
        rows.forEach(function (r) { if (r.depth > maxDepth) maxDepth = r.depth; });
        // ⚠ 深さは **インデント**で表す。★ 列は増やさない（ここは報告用の印だけ）
        flow.setAttribute('data-depth', String(maxDepth));
        rows.forEach(function (r) {
            flow.appendChild(r.kind === 'edge' ? edgeRow(r) : nodeRow(r));
        });
    }

    function renderTabs() {
        var mb = $('modes');
        mb.textContent = '';
        Object.keys(TREE_MODES).forEach(function (k) {
            var m = TREE_MODES[k];
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-mode', m.id);
            b.textContent = m.name;
            b.className = (state.mode === m.id) ? 'active' : '';
            // ★ やり方を替えても、いま出ている容器はそのまま（⚠ 引き直さない）
            b.addEventListener('click', function () { start(m.id, state.level, { ions: state.problem.ions }); });
            mb.appendChild(b);
        });
        // ★ 難易度は学習者が選ぶ（型B と同じ）。
        //   ⚠ 段の名前と印より多くを書かない —— 解き筋に触れない
        var pb = $('probs');
        pb.textContent = '';
        TREE_LEVELS.forEach(function (l) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-level', l.id);
            b.textContent = l.name + '　' + l.mark;
            b.className = (state.level === l.id) ? 'active' : '';
            b.addEventListener('click', function () { start(state.mode, l.id); });
            pb.appendChild(b);
        });
    }

    function render() {
        renderTabs();
        renderDecks();
        renderTree();
        $('btn-submit').disabled = state.submitted;
    }

    // ---------------------------------------------------------------
    // 提出 —— ★ ここで初めて、組んだ手順をそのまま走らせる
    // ---------------------------------------------------------------
    function swatch(colorName) {
        var s = document.createElement('span');
        s.className = 'sw';
        var hex = TREE_COLORS[colorName];
        if (hex) { s.style.background = hex; s.style.backgroundImage = 'none'; }
        s.title = colorName || '';
        return s;
    }

    function line(tag, build) {
        var d = document.createElement('div');
        d.className = 'line';
        var t = document.createElement('span');
        t.className = 'tag';
        t.textContent = tag;
        d.appendChild(t);
        build(d);
        return d;
    }

    /** 葉の呼び名（★ 何手目の何の沈殿か。⚠ 番号だけだと、どこの話か分からない） */
    function leafName(leafId) {
        if (leafId === TREE_FINAL_LEAF) return '最後のろ液';
        var m = /^L(\d+)([sp])?$/.exec(leafId);
        if (!m) return leafId;
        var slot = parseInt(m[1], 10);
        var base = (slot + 1) + '手目〔' + opShort(state.seq[slot]) + '〕の沈殿';
        if (!m[2]) return base;
        // ★★ 沈殿をさらに割った先（⚠ どちらの側かを言葉で分ける）
        var so = state.sub[slot];
        return base + 'を〔' + opShort(so) + '〕で割った' + (m[2] === 's' ? '、溶けた液' : '残り');
    }

    function p(text, cls) {
        var e = document.createElement('p');
        if (cls) e.className = cls;
        e.textContent = text;
        return e;
    }

    function submit() {
        if (state.submitted) return;
        state.submitted = true;
        var g = treeGrade(state.problem, state.seq, state.plan, state.sub);
        // ★ 記録は「後から率と共有の文面を組み立てられるだけ」を持つ（⚠ 送信も保存もしない）。
        //   正解率% ／ 最短手順正解率% ／ SNS 共有は **次の一手**（ここでは形だけ塞がない）
        state.record = treeRecord(state.mode, state.problem, {
            seq: state.seq.slice(),
            sub: JSON.parse(JSON.stringify(state.sub)),
            moves: g.moves, shortest: treeAuditProblem(state.problem).shortest,
            dirty: g.dirty, isolated: g.isolated, matched: g.matched, verdict: g.verdict
        });

        var box = $('result');
        box.textContent = '';

        // ★ 手数（⚠ 余計な手があっても不正解にしない。§ 2026-08-28 のユーザー決定）
        //   「最短」は門番が数えている理想の最短。⚠ 手順そのものは出さない
        //   —— **正解は1つではない**ので、1つ示すと他の正解を否定することになる
        var shortest = treeAuditProblem(state.problem).shortest;
        var moves = '（' + g.moves + '手／最短 ' + shortest + '手）';

        var h3 = document.createElement('h3');
        if (g.verdict === 'perfect') {
            h3.className = 'ok';
            h3.textContent = 'ぜんぶ単離できました' + moves;
        } else if (g.verdict === 'misread') {
            h3.className = 'ng';
            // ⚠ 「机上」は設計書の語であって、学習者の語ではない（★ 画面には出さない）
            h3.textContent = '単離はできましたが、置いた行先とは違いました' + moves;
        } else {
            h3.className = 'ng';
            h3.textContent = '単離できていない葉が ' + g.dirty + ' 枚あります' + moves;
        }
        box.appendChild(h3);
        if (g.isolated && g.moves > shortest) {
            box.appendChild(p('単離はできています。' + (g.moves - shortest) +
                '手ぶん、この容器では要らない操作が入っていました。', 'caveat'));
        }
        box.appendChild(p('あなたが並べた手順を、そのまま走らせました。'));

        // ★ 間違えたところを名指しする（2026-08-28・ユーザー「間違えたところを指摘すればよい」）
        //   ⚠ 模範の手順は出さない。★ 起きたことだけを言う
        if (!g.isolated) {
            var told = [];
            g.impure.forEach(function (l) {
                told.push(leafName(l) + 'に ' +
                    (g.actual[l] || []).map(elJp).join('と') + ' が入っています');
            });
            g.emptyPlanned.forEach(function (l) {
                var planned = (g.rows.filter(function (r) { return r.leaf === l; })[0] || {}).planned || [];
                told.push(leafName(l) + 'は空です' +
                    (planned.length ? '（' + planned.map(elJp).join('・') + ' を置きました）' : ''));
            });
            if (told.length) box.appendChild(p(told.join('。') + '。'));
        }

        if (g.unplaced.length) {
            box.appendChild(p('置かなかったイオン：' + g.unplaced.map(ionName).join('・')));
        }

        // 葉ごとに、実際に来たものと机上を並べる
        g.rows.forEach(function (r) {
            var d = document.createElement('div');
            var bad = (r.actual.length >= 2) || (r.actual.length === 0 && r.planned.length >= 1) || !r.same;
            d.className = 'leafrow ' + (bad ? 'bad' : 'good');
            var title = document.createElement('b');
            title.textContent = leafName(r.leaf);
            d.appendChild(title);

            // ★ その葉に来たものの「姿」を、走らせた結果から引く。
            //   ⚠ 沈殿を割った先は、割ったあとの姿（escaped / stay）で言う
            var shown = null;
            g.run.stages.forEach(function (s) {
                if (!s.op || !s.splits) return;
                if (s.sub) {
                    if (treeSubLeafId(s.slot, 's') === r.leaf) shown = s.escaped;
                    if (treeSubLeafId(s.slot, 'p') === r.leaf) shown = s.stay;
                } else if (treeLeafId(s.slot) === r.leaf) shown = s.ppt;
            });
            d.appendChild(line('実際に来たもの', function (row) {
                if (!r.actual.length) { row.appendChild(document.createTextNode('なし')); return; }
                if (shown) {
                    shown.forEach(function (e) {
                        row.appendChild(swatch(e.c));
                        var l = document.createElement('span');
                        l.textContent = e.f + '（' + e.c + '・' + elJp(treeElement(e.ion)) + '）';
                        row.appendChild(l);
                    });
                } else {
                    row.appendChild(document.createTextNode(
                        r.actual.map(function (e) { return elJp(e); }).join('・') + ' が溶けたまま残った'));
                }
            }));
            d.appendChild(line('あなたが置いた', function (row) {
                row.appendChild(document.createTextNode(
                    r.planned.length ? r.planned.map(elJp).join('・') : 'なし'));
            }));
            if (r.actual.length >= 2) {
                d.appendChild(p('⚠ ここに ' + r.actual.length + ' 種類が同居しています。単離できていません。'));
            } else if (r.actual.length === 0 && r.planned.length >= 1) {
                d.appendChild(p('⚠ ここには何も来ませんでした。'));
            }
            box.appendChild(d);
        });

        // ★★ 芯の説明（§4-3）。⚠ 警告ではなく、起きたことの説明として、ここで初めて出す
        if (g.feAsFeS && state.problem.ions.indexOf('Fe3') >= 0) {
            var w = document.createElement('div');
            w.className = 'why';
            w.appendChild(p('鉄は第3属です。'));
            w.appendChild(p('酸性で硫化水素を通したとき、硫化水素が還元剤としてはたらいて Fe³⁺ が Fe²⁺ になりました。'
                + 'そのままアンモニアの段に進んだので、Fe(OH)₂ は FeO(OH) ほど沈みやすくなく、沈みませんでした。'
                + '素通りした鉄は、あとの塩基性の硫化水素の段で FeS として沈んでいます。'));
            w.appendChild(p('煮沸して硫化水素を追い出し、希硝酸で Fe³⁺ に戻してから進むのは、このためです。'));
            // ⚠ D10（説明を足すなら断りは必須）。★ 本の名前とページは書かない（§18-6 (4)）
            w.appendChild(p('※「Fe(OH)₂ より FeO(OH) のほうがずっと沈殿しやすいので、確実に沈殿させるために戻す」'
                + 'までは、広く説明されています。「戻さないと鉄が第4属に現れて、属の分類そのものが崩れる」までは、'
                + 'この教材が足した説明です。', 'caveat'));
            box.appendChild(w);
        }

        // 各手で何が起きたか（★ 走らせた結果の中身。⚠ 提出したあとにだけ出す）
        g.run.stages.forEach(function (s) {
            if (!s.op) return;
            var d = document.createElement('div');
            d.className = 'leafrow';
            var b = document.createElement('b');
            b.textContent = (s.slot + 1) + '手目 〔' + opShort(s.op) + '〕';
            d.appendChild(b);
            // ★ 詳しい操作は、幅のあるここで言う（⚠ ツリーの行には入れない）
            if (TREE_OPS[s.op]) d.appendChild(p(TREE_OPS[s.op].say + '。', 'caveat'));
            if (s.ppt.length) {
                s.ppt.forEach(function (e) {
                    d.appendChild(p(e.f + '（' + e.c + '）が沈みました。' + e.why + '。'));
                });
            } else {
                d.appendChild(p(s.turb
                    ? s.turb.f + ' の' + s.turb.c + 'の濁りが出ましたが、沈殿は分かれませんでした。'
                    : 'ここでは何も沈みませんでした。'));
            }
            // ★★ 硫化水素だけは、そのときの容器の液性で結果が変わる。
            //   ⚠ 途中のツリーには出さない（§16-1）。★ 走らせたあとの説明として、ここで初めて言う
            if (s.op === 'h2s') {
                d.appendChild(p('このとき容器は' + TREE_PH_JP[s.ph] + 'でした。', 'caveat'));
            }
            // ⚠ 沈まなくても、化学種が変わっていることがある（★ この教材の芯）。
            //   ここを「操作のあとの状態」から引くと、希硝酸の手の説明が逆さまになる
            s.changes.forEach(function (ch) { d.appendChild(p(ch.why + '。', 'caveat')); });
            // ★ 何も沈まなかった手こそ、なぜ沈まなかったかを言う（⚠ 答え合わせの解説は削らない）
            if (!s.ppt.length && s.splits) {
                s.stayWhy.forEach(function (e) {
                    d.appendChild(p(ionName(e.ion) + '：' + e.why + '。', 'caveat'));
                });
            }
            box.appendChild(d);

            // ★★ 沈殿側の札を置いた段は、そのあとにもう1つ手が続く（＝ 沈殿を割った手）
            if (!s.sub) return;
            var d2 = document.createElement('div');
            d2.className = 'leafrow';
            var b2 = document.createElement('b');
            b2.textContent = (s.slot + 1) + '手目の沈殿 〔' + opShort(s.sub) + '〕';
            d2.appendChild(b2);
            d2.appendChild(p(opSay(s.sub) + '。', 'caveat'));
            s.escaped.forEach(function (e) {
                d2.appendChild(p(e.f + '（' + e.c + '）として溶け出しました。' + e.why + '。'));
            });
            s.stay.forEach(function (e) {
                d2.appendChild(p(e.f + '（' + e.c + '）は沈殿のまま残りました。' + e.why + '。'));
            });
            if (!s.escaped.length) {
                d2.appendChild(p('溶け出したものはありませんでした。', 'caveat'));
            }
            box.appendChild(d2);
        });

        box.className = 'result';
        render();
    }

    // ---------------------------------------------------------------
    // 始める
    // ---------------------------------------------------------------
    /**
     * @param modeId  やり方
     * @param levelId 難易度
     * @param opts    ⚠ **テストが出題を固定するための口**（ions / rand）。画面からは渡さない
     */
    function start(modeId, levelId, opts) {
        opts = opts || {};
        state.mode = modeId || state.mode;
        state.level = levelId || state.level;
        // ★ 直前と同じ容器は続けて出さない（⚠ 等確率で引くと同じ組が2回3回と続く）
        if (!opts.ions && state.lastKey) opts.avoid = state.lastKey;
        var p = treeMakeProblem(state.level, opts);
        if (!p) return;                     // ⚠ 母集団が空（＝ 段の切り方か門番の設計ミス）
        state.problem = p;
        state.lastKey = treeIonKey(p.ions);
        state.sel = null;
        state.submitted = false;
        state.plan = treeEmptyPlan();
        state.sub = {};
        // ⚠ 枝の数は札の枚数ではない（★ 硫化水素は1枚を2つの枝に置く）
        var n = treeSlotCount(state.problem);
        state.seq = [];
        for (var i = 0; i < n; i++) state.seq.push(null);
        if (state.mode === 'read') {
            // ★ 操作はもう置いてある（§16-2 のバリエーション）。⚠ 決めるのはイオンの行先だけ
            //   ★★ 沈殿側の札も置いてある —— ⚠ 置かないと「割らずに止めた木」になり、
            //     行先を答えるだけの段なのに単離できない答案しか作れなくなる
            var ideal = treeIdealSeq(state.problem);
            for (var j = 0; j < ideal.length && j < n; j++) state.seq[j] = ideal[j];
            state.sub = treeIdealSub(state.problem, state.seq);
        }
        state.record = treeRecord(state.mode, state.problem);
        $('result').textContent = '';
        $('result').className = 'result hidden';
        say('');
        render();
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('btn-submit').addEventListener('click', submit);
        // ★ 「置き直す」は同じ容器のまま最初から（⚠ 引き直さない）
        $('btn-reset').addEventListener('click', function () {
            start(state.mode, state.level, { ions: state.problem.ions });
        });
        $('btn-new').addEventListener('click', function () { start(state.mode, state.level); });
        start('read', 'easy');
    });

    // 回帰テスト（tests.js）が iframe の中から駆動するための口。
    // ⚠ 画面の都合で作った窓であって、ここに採点のロジックは置かない（模型は tree-model.js）
    window.treeUI = {
        state: state,
        start: start,
        pick: pick,
        placeOp: placeOp,
        placeSub: placeSub,
        placeIon: placeIon,
        submit: submit
    };
})();
