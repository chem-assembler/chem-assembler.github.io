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
        level: 'easy',   // 学習者が選んだ難易度
        problem: null,   // いま解いている問題（★ 毎回つくる。一覧は持たない）
        truth: null,     // 実際に入っているイオン（⚠ 答えるまで画面に出さない）
        history: [],     // [{op, obs}] ★ 押した順に積む。上書きしない
        answered: false,
        lastKey: null,   // ★ 直前に出した型の鍵。⚠ 続けて同じ型を出さないためだけに使う
        // ★ 記録の器（⚠ **持つだけ。送信も保存もしない**）。
        //   集計できる安定した単位は「型」であって、毎回つくる出題そのものではない
        record: null
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
                box.appendChild(note('色はつかない'));
                break;
            default: // keep / none / nopre
                // ⚠ 何も見えなかったことも「見えたもの」の1つ。空欄にせず、そう書く
                box.appendChild(swatch(null, 'none'));
                box.appendChild(note(obs.k === 'keep' ? '溶けない'
                    : obs.k === 'nopre' ? '沈殿ができない' : '変化なし'));
                break;
        }
        return box;
    }
    function note(text) {
        var l = document.createElement('span');
        l.className = 'sw-label';
        l.textContent = text;
        return l;
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
    /** 難易度は学習者が選ぶ。⚠ 段の名前と印より多くを書かない（解き筋に触れない） */
    function renderLevels() {
        var box = $('levels');
        box.textContent = '';
        SEP_LEVELS.forEach(function (l) {
            var b = document.createElement('button');
            b.type = 'button';
            b.textContent = l.name + '　' + l.mark;
            b.className = (state.level === l.id) ? 'active' : '';
            b.setAttribute('data-level', l.id);
            b.addEventListener('click', function () { start(l.id); });
            box.appendChild(b);
        });
    }

    function renderProblem() {
        var p = state.problem;
        // ⚠ ここに解き筋を書かない。出してよいのは難易度の印と候補の数だけ
        $('prob-note').textContent = levelOf(state.level).mark + '　候補 ' + p.cands.length;
        // ★ 人に見せる問題 ID（⚠ 中身は入っていないので、解いている最中に出してよい）
        $('prob-id').textContent = p.pid;
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

    function levelOf(id) {
        return SEP_LEVELS.filter(function (l) { return l.id === id; })[0] || SEP_LEVELS[0];
    }

    function renderAll() {
        renderLevels();
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

    /**
     * ★★ その回の成績（2026-08-28・ユーザー「問題にIDを付与、成績の集計へ」
     *   「結果を表示したい／正解率%　最短手順正解率%をだせるとよい」）。
     *
     * ⚠ ここに出すのは **今回1回ぶんだけ**。累計の率は出していない
     *   （★ 何回ぶんを、どこに貯めるかを決めていないため。§22 に申し送り）。
     * ★ 型B で手数を出してよい理由: **札を選んだのは学習者**だから
     *   （⚠ 型A の「イオンの行先を答える」で出さないのは、そこでは選んでいないから）。
     */
    function scoreBox(sc, g) {
        var box = document.createElement('div');
        box.className = 'score';
        var row = function (label, value) {
            var d = document.createElement('div');
            d.className = 'score-row';
            var k = document.createElement('span');
            k.className = 'score-k';
            k.textContent = label;
            var v = document.createElement('span');
            v.className = 'score-v';
            v.textContent = value;
            d.appendChild(k);
            d.appendChild(v);
            box.appendChild(d);
        };
        row('問題', state.problem.pid + '　' + levelOf(state.level).mark +
            '　候補 ' + state.problem.cands.length);
        row('判定', g.correct ? '正解' : '不正解');
        row('手数', sc.moves === 0 ? '操作なし' : sc.moves + '手');
        // ⚠⚠ **決めきった回にだけ、最短の手数を出す**（実機で読み比べて決めた）。
        //   ★ 決めきっていない回に出すと、数字が食い違って読める ——
        //     炎色1手で当てただけの回に「手数 1手／決めるのに要る手数 1手」と並ぶ。
        //     （⚠ この 1手 は「別の札なら1手で決まった」の意味で、
        //       学習者が押した札のことではない。★ 並べると、決まっていないのに
        //       最短で解けたように見える。）
        //   ★ 足りなかった回に何が足りないかは、下の判定の一文が
        //     「〔◯◯〕を行うと、この2つが分かれます」と名指しで言っている。
        //   ⚠ 記録（record）には決めきらなかった回も残す —— 表示と集計は別。
        if (sc.least != null && g.verdict === 'decided') {
            row('決めるのに要る手数', sc.least + '手' + (sc.minimal ? '　最短で当てました' : ''));
        }
        return box;
    }

    function answer(pick) {
        if (state.answered) return;
        state.answered = true;
        var g = sepGrade(state.problem, state.truth, pick, state.history);
        var sc = sepScore(state.problem, state.truth, state.history, g.verdict);
        // ★ 記録に結果を足す。⚠ **持つだけ。送信も保存もしない**
        //   （★ 集計するなら単位は `key`＝型。⚠ 出題そのものは毎回別物になる）
        state.record = sepRecord(state.problem, {
            picked: pick, correct: g.correct, verdict: g.verdict,
            steps: state.history.map(function (h) { return h.op; }),
            // ★ 率を後から出すのに要る数（⚠ 送信も保存もしない。持つだけ）
            moves: sc.moves, least: sc.least, shortest: sc.shortest, minimal: sc.minimal
        });
        var box = $('result');
        box.textContent = '';

        var h3 = document.createElement('h3');
        h3.className = g.correct ? 'ok' : 'ng';
        h3.textContent = g.correct ? '正解 — ' + ionFull(state.truth)
            : '正解は ' + ionFull(state.truth) + ' でした';
        box.appendChild(h3);
        // ★ その回の成績（⚠ 見出しのすぐ下。読む順は「結果 → なぜそうなったか」）
        box.appendChild(scoreBox(sc, g));

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
            // 出典の丸かっこで終わる書き方をしているので、句点はここでそろえる
            if (why.slice(-1) !== '。') why += '。';
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

    /** 炎色反応の解説。★ 色名が資料で割れるものは、割れていることごと伝える
        ⚠ 本の名前とページは出さない（教科書は1社ではないので、手元と合わない）。
          出典は模型の `ref` に持っている */
    function flameWhy(ionId) {
        var f = SEP_IONS[ionId].flame;
        if (!f) {
            return '炎色反応で色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7元素だけで、'
                + ionName(ionId) + ' は色を出しません。';
        }
        var s = ionName(ionId) + ' の炎色は' + f.names[0] + 'です。';
        if (f.names.length > 1) {
            s += '資料によっては「' + f.names.slice(1).join('」「') + '」とも書かれます。';
        }
        return s;
    }

    // ---------------------------------------------------------------
    // 始める —— ★ 問題は毎回つくる（一覧は持たない）
    // ---------------------------------------------------------------

    /**
     * @param levelId 難易度（省略時はいまの段）
     * @param opts    ⚠ **テストが出題を固定するための口**（cands / ops / truth / rand）。
     *                画面からは渡さない
     */
    function start(levelId, opts) {
        state.level = levelId || state.level;
        opts = opts || {};
        // ★ 直前と同じ型は続けて出さない（⚠ 等確率で引くと解き筋が2回3回と続く）
        if (!opts.cands && state.lastKey) opts.avoid = state.lastKey;
        var p = sepMakeProblem(state.level, opts);
        if (!p) return;                       // ⚠ 母集団が空（＝ 段の切り方か候補の設計ミス）
        state.problem = p;
        state.truth = p.truth;
        state.lastKey = p.key;
        state.history = [];
        state.answered = false;
        // ★ 記録の器をここで作る。⚠ **送信も保存もしない**（外へ出すかはユーザーの判断）
        state.record = sepRecord(p);
        renderAll();
    }

    document.addEventListener('DOMContentLoaded', function () {
        $('btn-answer').addEventListener('click', openAnswer);
        $('btn-new').addEventListener('click', function () { start(state.level); });
        $('btn-again').addEventListener('click', function () { start(state.level); });
        start('easy');
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
