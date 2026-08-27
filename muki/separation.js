// 色でみる無機化学 — 系統分離モード「型B: イオンをつきとめる」の画面
//
// DESIGN_separation.md §16-1（型B は「実験台」）に従う:
//   ・1手ごとにアプリが視覚的に結果を返す
//   ・⚠ **毎回の結果を保存して、操作を足すごとに並べる**（「いまの姿」だけを持たない）
//   ・「判定できた」と本人が思った段階で答えを選ぶ
//   ・答え合わせで、それまでの結果の解説とともに正解が出る
//
// ⚠ 途中では何も言わない（D1(a)・§3-5-4）。
//   残っている候補の数も、その操作が効いたかどうかも、答えるまで出さない。
//   ★ 「あなたの操作でこうなりました」は、答え合わせで初めて言う（§3-3 の文面の向き）。
//
// ⚠ 「まだわからない」は作らない（§16-3。型B は答えるタイミングを学習者が握っているので、
//   当てずっぽうを強いる構図がそもそも生まれない）。

(function () {
    'use strict';

    var state = {
        problem: null,   // いま解いている問題
        truth: null,     // 実際に入っているイオン（⚠ 答えるまで画面に出さない）
        history: [],     // [{op, obs}] ★ 押した順に積む。上書きしない
        answered: false
    };

    var $ = function (id) { return document.getElementById(id); };

    function ionName(id) { return SEP_IONS[id] ? SEP_IONS[id].name : id; }
    function ionFull(id) {
        var i = SEP_IONS[id];
        return i ? i.name + '（' + i.jp + '）' : id;
    }
    function opName(id) { return SEP_OPS[id] ? SEP_OPS[id].short : id; }

    // ---------------------------------------------------------------
    // 見えたものの絵。⚠ 色を混ぜて1色にしない（§5-5）。並べて見せる
    // ---------------------------------------------------------------
    function swatch(colorName, kind) {
        var d = document.createElement('span');
        d.className = 'sw' + (kind ? ' ' + kind : '');
        var hex = SEP_COLORS[colorName];
        if (hex) { d.style.background = hex; d.style.backgroundImage = 'none'; }
        d.title = colorName || '';
        return d;
    }
    function labeled(colorName, kind) {
        var wrap = document.createDocumentFragment();
        wrap.appendChild(swatch(colorName, kind));
        var l = document.createElement('span');
        l.className = 'sw-label';
        l.textContent = colorName;
        wrap.appendChild(l);
        return wrap;
    }
    function drawObs(obs) {
        var box = document.createElement('div');
        box.className = 'swatches';
        if (!obs) return box;
        switch (obs.k) {
            case 'ppt':
                box.appendChild(labeled(obs.c));
                break;
            case 'pptGone':
                box.appendChild(labeled(obs.c));
                box.appendChild(arrow());
                box.appendChild(labeled(obs.toc));
                break;
            case 'pptKeep':
                box.appendChild(labeled(obs.c));
                break;
            case 'dissolve':
                box.appendChild(labeled(obs.toc));
                break;
            case 'flame':
                box.appendChild(labeled(obs.c, 'flame'));
                break;
            case 'flameNone':
                box.appendChild(swatch(null, 'flame none'));
                break;
            default: // keep / none / nopre
                box.appendChild(swatch(null, 'none'));
                break;
        }
        return box;
    }
    function arrow() {
        var a = document.createElement('span');
        a.className = 'arrow';
        a.textContent = '→';
        return a;
    }

    // ---------------------------------------------------------------
    // 描画
    // ---------------------------------------------------------------
    function renderTabs() {
        var box = $('prob-tabs');
        box.textContent = '';
        SEP_PROBLEMS.forEach(function (p, i) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = (i + 1) + '. ' + p.title;
            b.className = (state.problem && state.problem.id === p.id) ? 'active' : '';
            b.setAttribute('data-prob', p.id);
            b.addEventListener('click', function () { start(p.id); });
            box.appendChild(b);
        });
    }

    function renderProblem() {
        var p = state.problem;
        $('prob-title').textContent = p.title;
        $('prob-note').textContent = p.note;
        var box = $('cand-list');
        box.textContent = '';
        p.cands.forEach(function (c) {
            var s = document.createElement('span');
            s.className = 'chip';
            s.textContent = ionName(c);
            s.setAttribute('data-ion', c);
            box.appendChild(s);
        });
    }

    function renderOps() {
        var box = $('ops');
        box.textContent = '';
        state.problem.ops.forEach(function (o) {
            var op = SEP_OPS[o];
            var used = state.history.some(function (h) { return h.op === o; });
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'op';
            b.setAttribute('data-op', o);
            b.disabled = used || state.answered;
            var n = document.createElement('span');
            n.className = 'op-name';
            n.textContent = op.short;
            var s = document.createElement('span');
            s.className = 'op-say';
            s.textContent = op.say;
            b.appendChild(n);
            b.appendChild(s);
            if (used) {
                var d = document.createElement('span');
                d.className = 'op-done';
                d.textContent = '実施済み';
                b.appendChild(d);
            }
            b.addEventListener('click', function () { doOp(o); });
            box.appendChild(b);
        });
    }

    /** ★ 結果は積む。⚠ 直前の結果を書き換えない */
    function renderLog() {
        var ol = $('log');
        ol.textContent = '';
        state.history.forEach(function (h, i) {
            var li = document.createElement('li');
            var st = document.createElement('span');
            st.className = 'step';
            st.textContent = (i + 1) + '手目';
            var body = document.createElement('div');
            body.className = 'body';
            var what = document.createElement('div');
            what.className = 'what';
            what.textContent = SEP_OPS[h.op].say;
            var seen = document.createElement('div');
            seen.className = 'seen';
            seen.textContent = sepObsText(h.obs);
            body.appendChild(what);
            body.appendChild(drawObs(h.obs));
            body.appendChild(seen);
            li.appendChild(st);
            li.appendChild(body);
            ol.appendChild(li);
        });
        $('log-empty').className = state.history.length ? 'note hidden' : 'note';
        $('log-count').textContent = state.history.length ? '（' + state.history.length + '手）' : '';
    }

    function renderAll() {
        renderTabs();
        renderProblem();
        renderOps();
        renderLog();
        $('btn-answer').disabled = state.answered;
        $('answer-choices').className = 'chips hidden';
        $('result').className = 'result hidden';
        $('after').className = 'after hidden';
    }

    // ---------------------------------------------------------------
    // 操作する
    // ---------------------------------------------------------------
    function doOp(opId) {
        if (state.answered) return;
        if (state.history.some(function (h) { return h.op === opId; })) return;
        var obs = sepObserve(state.truth, opId);
        // ⚠ 表に無い組は「変化なし」にしない。扱っていないと言う（§4-1）
        state.history.push({ op: opId, obs: obs });
        renderOps();
        renderLog();
    }

    // ---------------------------------------------------------------
    // 答える
    // ---------------------------------------------------------------
    function openAnswer() {
        var box = $('answer-choices');
        box.textContent = '';
        var head = document.createElement('p');
        head.className = 'note';
        head.textContent = 'この容器に入っていたのはどれですか。';
        box.appendChild(head);
        state.problem.cands.forEach(function (c) {
            var b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('data-pick', c);
            b.textContent = ionName(c);
            b.addEventListener('click', function () { answer(c); });
            box.appendChild(b);
        });
        box.className = 'chips';
    }

    function p(text, cls) {
        var e = document.createElement('p');
        if (cls) e.className = cls;
        e.textContent = text;
        return e;
    }

    /** まだ試していない札のうち、a と b を分けるもの（無ければ全部から探す） */
    function separatingOp(a, b) {
        var ops = state.problem.ops;
        var unused = ops.filter(function (o) {
            return !state.history.some(function (h) { return h.op === o; });
        });
        var hit = unused.filter(function (o) { return sepSeparates([o], a, b); });
        if (hit.length) return hit[0];
        hit = ops.filter(function (o) { return sepSeparates([o], a, b); });
        return hit.length ? hit[0] : null;
    }

    function answer(pick) {
        if (state.answered) return;
        state.answered = true;
        var g = sepGrade(state.problem, state.truth, pick, state.history);
        var box = $('result');
        box.textContent = '';

        var h3 = document.createElement('h3');
        h3.className = g.correct ? 'ok' : 'ng';
        h3.textContent = g.correct ? '正解 — ' + ionFull(state.truth)
            : '正解は ' + ionFull(state.truth) + ' でした';
        box.appendChild(h3);

        // ★ 判定の一文。⚠ 「あなたは間違えました」ではなく「あなたの操作でこうなりました」
        if (g.verdict === 'decided') {
            box.appendChild(p('あなたが行った操作で、候補は1つに決まっていました。'));
        } else if (g.verdict === 'lucky') {
            var others = g.alive.filter(function (c) { return c !== state.truth; });
            box.appendChild(p('あなたの観察と矛盾しない候補は、まだ ' + g.alive.length + ' つ残っていました（'
                + g.alive.map(ionName).join('・') + '）。今回は当たりましたが、'
                + ionName(others[0]) + ' が入っていた試料に同じ手順を行っても、あなたには同じものしか見えません。'));
            var so = separatingOp(state.truth, others[0]);
            if (so) box.appendChild(p('〔' + opName(so) + '〕を行うと、この2つが分かれます。'));
        } else if (g.verdict === 'unread') {
            box.appendChild(p('あなたが選んだ ' + ionName(pick) + ' は、ここまでの観察と食い違ってはいません。'
                + 'ただし ' + ionName(state.truth) + ' も同じ見え方をするので、この手順では2つを分けられていませんでした。'));
            var so2 = separatingOp(pick, state.truth);
            if (so2) box.appendChild(p('〔' + opName(so2) + '〕を行うと、この2つが分かれます。'));
        } else { // missed
            var c0 = g.conflicts[0];
            box.appendChild(p(c0.step + '手目の〔' + opName(c0.op) + '〕で、' + sepObsText(c0.seen)
                + ' ' + ionName(pick) + ' なら、ここでは「' + sepObsText(c0.expected) + '」が見えます。'));
        }

        // ★ それまでの結果の解説（§16-1「それまでの結果の解説とともに正解が提示される」）
        if (g.steps.length === 0) {
            box.appendChild(p('操作を1つも行わずに答えました。何を見て決めたかを、あとから説明できる形にしておきましょう。', 'note'));
        }
        g.steps.forEach(function (s) {
            var d = document.createElement('div');
            d.className = 'why';
            var b = document.createElement('b');
            b.textContent = s.step + '手目 〔' + opName(s.op) + '〕 ' + sepObsText(s.obs) + ' ';
            d.appendChild(b);
            var entry = SEP_TABLE[state.truth] && SEP_TABLE[state.truth][s.op];
            var why = entry ? entry.why : flameWhy(state.truth);
            d.appendChild(document.createTextNode(why));
            var dr = document.createElement('div');
            dr.className = 'drop';
            dr.textContent = s.dropped.length
                ? 'これで ' + s.dropped.map(ionName).join('・') + ' が消えました。'
                : 'この操作では、候補は1つも減りませんでした。';
            d.appendChild(dr);
            box.appendChild(d);
        });

        if (g.verdict !== 'decided') {
            box.appendChild(p('※ 実際の試験では、答えが1つに決まるまで操作を続けてから答えます。', 'note'));
        }
        box.className = 'result';
        $('answer-choices').className = 'chips hidden';
        $('btn-answer').disabled = true;
        $('after').className = 'after';
        renderOps();
    }

    /** 炎色反応の解説。★ 色名が資料で割れるものは、割れていることごと伝える */
    function flameWhy(ionId) {
        var f = SEP_IONS[ionId].flame;
        if (!f) {
            return '炎色反応で色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7元素だけで、'
                + ionName(ionId) + ' は色を出しません（教科書 化学基礎 p.21 表3）。';
        }
        var s = ionName(ionId) + ' の炎色は' + f.names[0] + 'です（教科書 化学 p.88 図1）。';
        if (f.names.length > 1) {
            s += '資料によっては「' + f.names.slice(1).join('」「') + '」とも書かれます。';
        }
        return s;
    }

    // ---------------------------------------------------------------
    // 始める
    // ---------------------------------------------------------------
    function pickTruth(p) {
        return p.cands[Math.floor(Math.random() * p.cands.length)];
    }

    /** @param truthId 省略時はランダム（回帰テストは中身を指定して呼ぶ） */
    function start(problemId, truthId) {
        var p = SEP_PROBLEMS.filter(function (x) { return x.id === problemId; })[0] || SEP_PROBLEMS[0];
        state.problem = p;
        state.truth = truthId || pickTruth(p);
        state.history = [];
        state.answered = false;
        renderAll();
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('btn-answer').addEventListener('click', openAnswer);
        $('btn-again').addEventListener('click', function () { start(state.problem.id); });
        start(SEP_PROBLEMS[0].id);
    });

    // 回帰テスト（tests.js）が iframe の中から駆動するための口。
    // ⚠ 画面の都合で作った窓であって、ここに判定のロジックは置かない（模型は separation-model.js）
    window.sepUI = {
        state: state,
        start: start,
        doOp: doOp,
        openAnswer: openAnswer,
        answer: answer
    };
})();
