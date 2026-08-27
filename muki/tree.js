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
        problem: null,
        seq: [],            // 枝に置かれた操作。⚠ 空の枝は null（★ 詰めない。葉の番号がずれる）
        plan: {},           // 本人の机上。{ ionId: leafId }
        sel: null,          // いま選んでいる札 { type:'op'|'ion', id }
        submitted: false,
        record: null        // ★ 型の鍵（⚠ 送信も保存もしない。持つだけ。§18-6 (3) と同じ作法）
    };

    var $ = function (id) { return document.getElementById(id); };

    function ionName(id) { var i = treeIon(id); return i ? i.name : id; }
    function ionFull(id) { var i = treeIon(id); return i ? i.name + '（' + i.jp + '）' : id; }
    function opShort(id) { return TREE_OPS[id] ? TREE_OPS[id].short : id; }
    function elJp(el) { return TREE_ELEMENT_JP[el] || el; }

    // ---------------------------------------------------------------
    // 手札
    // ---------------------------------------------------------------
    function usedOps() { return state.seq.filter(function (o) { return !!o; }); }
    function placedIons() { return Object.keys(state.plan); }

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
        say(state.sel
            ? (type === 'op' ? '〔' + opShort(id) + '〕を、置きたい枝を押して置いてください。'
                : ionName(id) + ' を、行先の葉を押して置いてください。')
            : '');
        render();
    }

    function say(msg) { $('hint').textContent = msg || ''; }

    // ---------------------------------------------------------------
    // ツリー
    // ---------------------------------------------------------------
    function leafExists(leafId) {
        if (leafId === TREE_FINAL_LEAF) return true;
        var slot = parseInt(leafId.slice(1), 10);
        var op = state.seq[slot];
        return !!op && TREE_OPS[op].splits;
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
        dropOrphans();
        render();
    }

    function placeIon(leafId) {
        if (state.submitted) return;
        if (!state.sel || state.sel.type !== 'ion') { say('先にイオンの札を押してください。'); return; }
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

    function leafBlock(leafId, title) {
        var wrap = document.createElement('div');
        wrap.className = 'leafwrap';
        var t = document.createElement('div');
        t.className = 'leaf-title';
        t.textContent = title;
        wrap.appendChild(t);
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'slot leaf empty' + (state.sel && state.sel.type === 'ion' ? ' can' : '');
        b.setAttribute('data-leaf', leafId);
        b.textContent = 'イオンを置く';
        b.disabled = state.submitted;
        b.addEventListener('click', function () { placeIon(leafId); });
        wrap.appendChild(b);
        wrap.appendChild(placedBox(leafId));
        return wrap;
    }

    function placedBox(leafId) {
        var box = document.createElement('div');
        box.className = 'placed';
        box.setAttribute('data-placed', leafId);
        Object.keys(state.plan).forEach(function (ionId) {
            if (state.plan[ionId] !== leafId) return;
            var b = card('ion', ionId, ionName(ionId));
            b.disabled = state.submitted;
            b.addEventListener('click', function () { removeIon(ionId); });
            box.appendChild(b);
        });
        return box;
    }

    function renderTree() {
        $('beaker-ions').textContent = state.problem.ions.map(ionName).join('　');

        var ol = $('stages');
        ol.textContent = '';
        state.seq.forEach(function (opId, slot) {
            var li = document.createElement('li');
            li.className = 'stage' + (opId ? ' filled' : '');
            li.setAttribute('data-slot', String(slot));

            var stem = document.createElement('div');
            stem.className = 'stem';
            stem.textContent = String(slot + 1);
            li.appendChild(stem);

            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'slot branch' + (opId ? ' set' : ' empty') +
                (state.mode === 'read' ? ' locked' : '') +
                (!opId && state.sel && state.sel.type === 'op' ? ' can' : '');
            b.setAttribute('data-slot', String(slot));
            b.disabled = state.submitted || state.mode === 'read';
            if (opId) {
                var n = document.createElement('span');
                n.textContent = TREE_OPS[opId].short;
                var s = document.createElement('span');
                s.className = 'sub';
                s.textContent = TREE_OPS[opId].say;
                b.appendChild(n);
                b.appendChild(s);
                b.addEventListener('click', function () { removeOp(slot); });
            } else {
                b.textContent = '操作を置く';
                b.addEventListener('click', function () { placeOp(slot); });
            }
            li.appendChild(b);

            // ★ 葉が生えるのは、沈殿をつくりうる操作を置いた枝だけ。
            //   ⚠ 煮沸・希硝酸は何も沈めないので、葉が生えない
            if (opId && TREE_OPS[opId].splits) {
                li.appendChild(leafBlock(treeLeafId(slot), (slot + 1) + '手目の沈殿'));
            }
            ol.appendChild(li);
        });

        var fb = $('leaf-F');
        fb.className = 'slot leaf empty' + (state.sel && state.sel.type === 'ion' ? ' can' : '');
        fb.disabled = state.submitted;
        var box = $('placed-F');
        box.textContent = '';
        Object.keys(state.plan).forEach(function (ionId) {
            if (state.plan[ionId] !== TREE_FINAL_LEAF) return;
            var b = card('ion', ionId, ionName(ionId));
            b.disabled = state.submitted;
            b.addEventListener('click', function () { removeIon(ionId); });
            box.appendChild(b);
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
            b.textContent = m.name + '　' + m.mark;
            b.className = (state.mode === m.id) ? 'active' : '';
            b.addEventListener('click', function () { start(m.id, state.problem.id); });
            mb.appendChild(b);
        });
        var pb = $('probs');
        pb.textContent = '';
        TREE_PROBLEMS.forEach(function (p, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-prob', p.id);
            // ⚠ 見出しに解き筋を書かない。★ 出すのは中身の数だけ
            b.textContent = '容器 ' + (i + 1) + '（' + p.ions.length + '種）';
            b.className = (state.problem.id === p.id) ? 'active' : '';
            b.addEventListener('click', function () { start(state.mode, p.id); });
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

    function p(text, cls) {
        var e = document.createElement('p');
        if (cls) e.className = cls;
        e.textContent = text;
        return e;
    }

    function submit() {
        if (state.submitted) return;
        state.submitted = true;
        var g = treeGrade(state.problem, state.seq, state.plan);
        state.record = treeRecord(state.mode, state.problem, {
            seq: state.seq.slice(),
            dirty: g.dirty, isolated: g.isolated, matched: g.matched, verdict: g.verdict
        });

        var box = $('result');
        box.textContent = '';

        var h3 = document.createElement('h3');
        if (g.verdict === 'perfect') {
            h3.className = 'ok';
            h3.textContent = 'ぜんぶ単離できました';
        } else if (g.verdict === 'misread') {
            h3.className = 'ng';
            h3.textContent = '単離はできましたが、行先が机上と違いました';
        } else {
            h3.className = 'ng';
            h3.textContent = '単離できていない葉が ' + g.dirty + ' 枚あります';
        }
        box.appendChild(h3);
        box.appendChild(p('あなたが並べた手順を、そのまま走らせました。'));

        if (g.unplaced.length) {
            box.appendChild(p('置かなかったイオン：' + g.unplaced.map(ionName).join('・')));
        }

        // 葉ごとに、実際に来たものと机上を並べる
        g.rows.forEach(function (r) {
            var d = document.createElement('div');
            var bad = (r.actual.length >= 2) || (r.actual.length === 0 && r.planned.length >= 1) || !r.same;
            d.className = 'leafrow ' + (bad ? 'bad' : 'good');
            var title = document.createElement('b');
            if (r.leaf === TREE_FINAL_LEAF) title.textContent = '最後のろ液';
            else {
                var slot = parseInt(r.leaf.slice(1), 10);
                title.textContent = (slot + 1) + '手目〔' + opShort(state.seq[slot]) + '〕の沈殿';
            }
            d.appendChild(title);

            var stage = null;
            g.run.stages.forEach(function (s) { if (treeLeafId(s.slot) === r.leaf) stage = s; });
            d.appendChild(line('実際に来たもの', function (row) {
                if (!r.actual.length) { row.appendChild(document.createTextNode('なし')); return; }
                if (stage) {
                    stage.ppt.forEach(function (e) {
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
        });

        box.className = 'result';
        render();
    }

    // ---------------------------------------------------------------
    // 始める
    // ---------------------------------------------------------------
    function start(modeId, probId) {
        state.mode = modeId || state.mode;
        state.problem = treeProblem(probId || (state.problem && state.problem.id));
        state.sel = null;
        state.submitted = false;
        state.plan = treeEmptyPlan();
        // ⚠ 枝の数は札の枚数ではない（★ 硫化水素は1枚を2つの枝に置く）
        var n = treeSlotCount(state.problem);
        state.seq = [];
        for (var i = 0; i < n; i++) state.seq.push(null);
        if (state.mode === 'read') {
            // ★ 操作はもう置いてある（§16-2 のバリエーション）。⚠ 決めるのはイオンの行先だけ
            var ideal = treeIdealSeq(state.problem);
            for (var j = 0; j < ideal.length && j < n; j++) state.seq[j] = ideal[j];
        }
        state.record = treeRecord(state.mode, state.problem);
        $('result').textContent = '';
        $('result').className = 'result hidden';
        say('');
        render();
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('btn-submit').addEventListener('click', submit);
        $('btn-reset').addEventListener('click', function () { start(state.mode, state.problem.id); });
        $('leaf-F').addEventListener('click', function () { placeIon(TREE_FINAL_LEAF); });
        start('read', 'a1');
    });

    // 回帰テスト（tests.js）が iframe の中から駆動するための口。
    // ⚠ 画面の都合で作った窓であって、ここに採点のロジックは置かない（模型は tree-model.js）
    window.treeUI = {
        state: state,
        start: start,
        pick: pick,
        placeOp: placeOp,
        placeIon: placeIon,
        submit: submit
    };
})();
