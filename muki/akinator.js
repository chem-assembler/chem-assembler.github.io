// 色でみる無機化学 — 「かくれた物質をつきとめる」（アキネーター）の画面
//
// ⚠⚠ **向き**（DESIGN_akinator.md §0）:
//   アプリは正体を隠して持っているだけで、**質問は学習者が選ぶ。**
//   ⛔ アプリが「次はこれを訊きなさい」と勧めない。★ 情報量の計算は**答え合わせでだけ**使う。
//
// ⚠ 途中では何も言わない（§6-6。型B の画面と同じ縛り）。
//   残っている候補の数も、その質問が効いたかどうかも、答えるまで出さない。
//   ★ 「あなたの質問でこうなりました」は、答え合わせで初めて言う。
//
// ★★ **候補の札は、学習者が自分で伏せられる**（2026-09-12 に足した。⚠ 設計書には無い）。
//   ⚠ 候補が 30 件あるので、消えたものを頭の中だけで持つのは無理がある。
//   ★ ただし**伏せるのは学習者の仕事**で、アプリは1つも伏せない ——
//     伏せ方が間違っていても何も言わない（＝ 絞り込みの仕事を肩代わりしない）。
//
// ★★ デッキは差し替えられる（`?deck=<id>`）。⚠ **ページは増やさない。**
//   この画面はデッキの中身を知らない（色の名前と hex すらデッキから受け取る）。

(function () {
    'use strict';

    var DEFAULT_DECK = 'muki1';

    var state = {
        deck: null,
        problem: null,
        truth: null,      // ⚠ 答えるまで画面に出さない
        history: [],      // [{card, ans}] ★ 訊いた順に積む
        answered: false,
        marked: {},       // ★ 学習者が自分で伏せた候補（⚠ 採点には一切使わない）
        tag: '',          // 札の絞り込み（タグ）
        q: '',            // 札の絞り込み（検索）
        record: null      // ★ 記録の器（⚠ 持つだけ。送信も保存もしない）
    };

    var $ = function (id) { return document.getElementById(id); };

    function candOf(id) { return akiCand(state.deck, id); }
    function candName(id) { var c = candOf(id); return c ? c.name : id; }
    function candFull(id) {
        var c = candOf(id);
        return c ? c.name + '（' + c.jp + '）' : id;
    }
    function cardOf(id) { return akiCard(state.deck, id); }
    function cardSay(id) { var c = cardOf(id); return c ? c.say : id; }

    // ---------------------------------------------------------------
    // 色の四角。⚠ 色は名前が主で、この四角はその見える化にすぎない
    // ---------------------------------------------------------------
    function swatch(colorName) {
        var d = document.createElement('span');
        d.className = 'sw';
        var hex = state.deck.colors ? state.deck.colors[colorName] : null;
        if (hex) { d.style.background = hex; d.style.backgroundImage = 'none'; }
        d.title = colorName || '';
        return d;
    }

    // ---------------------------------------------------------------
    // 候補（⚠ 30件そのまま。★ 途中で1つも減らさない）
    // ---------------------------------------------------------------
    function renderCands() {
        var box = $('cand-list');
        box.textContent = '';
        akiCandIds(state.deck).forEach(function (id) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip' + (state.marked[id] ? ' off' : '') +
                (state.answered ? ' pick' : '');
            b.setAttribute('data-cand', id);
            b.textContent = candName(id);
            b.title = candFull(id);
            b.addEventListener('click', function () {
                if (state.answered) return;
                state.marked[id] = !state.marked[id];
                renderCands();
            });
            box.appendChild(b);
        });
        $('cand-count').textContent = akiCandIds(state.deck).length + ' 件';
    }

    // ---------------------------------------------------------------
    // 質問の一覧（★ 行で畳み、タグと検索で絞る。§5）
    // ---------------------------------------------------------------
    function matches(card) {
        if (state.tag && card.tag !== state.tag) return false;
        if (!state.q) return true;
        var q = state.q.toLowerCase();
        var hay = [card.say, card.mean, card.cell, card.row]
            .concat(card.keys || []).join(' ').toLowerCase();
        return hay.indexOf(q) >= 0;
    }

    function renderTags() {
        var box = $('tags');
        box.textContent = '';
        var tags = [];
        state.deck.cards.forEach(function (c) { if (tags.indexOf(c.tag) < 0) tags.push(c.tag); });
        [''].concat(tags).forEach(function (t) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'tag' + (state.tag === t ? ' active' : '');
            b.setAttribute('data-tag', t || 'all');
            b.textContent = t || 'すべて';
            b.addEventListener('click', function () { state.tag = t; renderCards(); renderTags(); });
            box.appendChild(b);
        });
    }

    function renderCards() {
        var box = $('card-rows');
        box.textContent = '';
        var rows = [];
        state.deck.cards.forEach(function (c) { if (rows.indexOf(c.row) < 0) rows.push(c.row); });
        var shown = 0;
        rows.forEach(function (row) {
            var cells = state.deck.cards.filter(function (c) { return c.row === row && matches(c); });
            if (!cells.length) return;
            var d = document.createElement('div');
            d.className = 'qrow';
            d.setAttribute('data-row', row);
            var h = document.createElement('div');
            h.className = 'qrow-h';
            h.textContent = row;
            var wrap = document.createElement('div');
            wrap.className = 'qcells';
            cells.forEach(function (c) {
                var used = state.history.some(function (h2) { return h2.card === c.id; });
                var b = document.createElement('button');
                b.type = 'button';
                b.className = 'q' + (used ? ' used' : '');
                b.setAttribute('data-card', c.id);
                b.disabled = used || state.answered;
                b.title = c.say;
                b.setAttribute('aria-label', c.say);
                if (c.color) b.appendChild(swatch(c.color));
                var t = document.createElement('span');
                t.textContent = c.cell || c.say;
                b.appendChild(t);
                b.addEventListener('click', function () { ask(c.id); });
                wrap.appendChild(b);
                shown++;
            });
            d.appendChild(h);
            d.appendChild(wrap);
            box.appendChild(d);
        });
        $('card-empty').className = shown ? 'note hidden' : 'note';
        $('card-count').textContent = shown + ' / ' + state.deck.cards.length;
    }

    // ---------------------------------------------------------------
    // 訊いたこと（★ 積む。⚠ 上書きしない）
    // ---------------------------------------------------------------
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
            what.textContent = cardSay(h.card);
            var seen = document.createElement('div');
            seen.className = 'seen ' + (h.ans ? 'yes' : 'no');
            seen.textContent = h.ans ? 'はい' : 'いいえ';
            body.appendChild(what);
            body.appendChild(seen);
            li.appendChild(st);
            li.appendChild(body);
            ol.appendChild(li);
        });
        $('log-empty').className = state.history.length ? 'note hidden' : 'note';
        $('log-count').textContent = state.history.length ? '（' + state.history.length + '手）' : '';
    }

    function renderAll() {
        $('deck-name').textContent = state.deck.name + '　' + state.deck.sub;
        renderCands();
        renderTags();
        renderCards();
        renderLog();
        $('btn-answer').disabled = state.answered;
        $('answer-choices').className = 'chips hidden';
        $('result').className = 'result hidden';
        $('after').className = 'after hidden';
    }

    // ---------------------------------------------------------------
    // 質問する
    // ---------------------------------------------------------------
    function ask(cardId) {
        if (state.answered) return;
        if (state.history.some(function (h) { return h.card === cardId; })) return;
        var ans = akiAnswer(state.deck, state.truth, cardId);
        state.history.push({ card: cardId, ans: ans });
        renderCards();
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
        head.textContent = 'かくれていたのはどれですか。';
        box.appendChild(head);
        var wrap = document.createElement('div');
        wrap.className = 'chips';
        akiCandIds(state.deck).forEach(function (id) {
            var b = document.createElement('button');
            b.type = 'button';
            b.className = 'chip pick' + (state.marked[id] ? ' off' : '');
            b.setAttribute('data-pick', id);
            b.textContent = candName(id);
            b.addEventListener('click', function () { answer(id); });
            wrap.appendChild(b);
        });
        box.appendChild(wrap);
        box.className = 'answer';
    }

    function p(text, cls) {
        var e = document.createElement('p');
        if (cls) e.className = cls;
        e.textContent = text;
        return e;
    }

    /** まだ訊いていない札のうち、a と b を分けるもの（無ければ全部から探す） */
    function separatingCard(a, b) {
        var all = akiCardIds(state.deck);
        var unused = all.filter(function (q) {
            return !state.history.some(function (h) { return h.card === q; });
        });
        var hit = unused.filter(function (q) { return akiSeparates(state.deck, [q], a, b); });
        if (hit.length) return hit[0];
        hit = all.filter(function (q) { return akiSeparates(state.deck, [q], a, b); });
        return hit.length ? hit[0] : null;
    }

    /** その回の成績（§6-6。⚠ 今回1回ぶんだけ。累計の率は出していない） */
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
        row('判定', g.correct ? '正解' : '不正解');
        row('質問した数', sc.moves === 0 ? '質問なし' : sc.moves + '手');
        // ⚠⚠ **決めきった回にだけ出す**（型B の画面と同じ決め）。
        //   ★ 決まっていない回に「最短」を並べると、決めきったように読める
        if (sc.least != null && g.verdict === 'decided') {
            row('そのうち要ったのは', sc.least + '手' + (sc.minimal ? '　むだなく当てました' : ''));
        }
        // ★ 全部の札を使ってよいときの最短（⚠ 厳密でなければ「見つけた中で」と書く ＝ 嘘をつかない）
        if (sc.ideal != null) {
            row('いちばん短い道', sc.ideal + '手' + (sc.idealExact ? '' : '（見つけた中で）'));
        }
        return box;
    }

    function answer(pick) {
        if (state.answered) return;
        state.answered = true;
        var d = state.deck;
        var g = akiGrade(d, state.truth, pick, state.history);
        var sc = akiScore(d, state.truth, state.history, g.verdict, g);
        // ★ 記録に結果を足す。⚠ **持つだけ。送信も保存もしない**
        state.record = akiRecord(state.problem, {
            picked: pick, correct: g.correct, verdict: g.verdict,
            asked: state.history.map(function (h) { return h.card; }),
            moves: sc.moves, least: sc.least, ideal: sc.ideal, minimal: sc.minimal
        });

        var box = $('result');
        box.textContent = '';
        var h3 = document.createElement('h3');
        h3.className = g.correct ? 'ok' : 'ng';
        h3.textContent = g.correct ? '当たりました — ' + candFull(state.truth)
            : 'かくれていたのは ' + candFull(state.truth) + ' でした';
        box.appendChild(h3);
        box.appendChild(scoreBox(sc, g));

        // ★ 判定の一文。⚠ 「あなたは間違えました」ではなく「あなたの質問でこうなりました」
        if (g.verdict === 'decided') {
            box.appendChild(p('あなたの質問で、候補は1つに決まっていました。'));
        } else if (g.verdict === 'lucky') {
            var others = g.alive.filter(function (c) { return c !== state.truth; });
            box.appendChild(p('あなたの答えと矛盾しない候補は、まだ ' + g.alive.length + ' つ残っていました（'
                + g.alive.map(candName).join('・') + '）。今回は当たりましたが、'
                + candName(others[0]) + ' がかくれていても、同じ答えしか返ってきません。'));
            var so = separatingCard(state.truth, others[0]);
            if (so) box.appendChild(p('「' + cardSay(so) + '」と訊くと、この2つが分かれます。'));
        } else if (g.verdict === 'unread') {
            box.appendChild(p('あなたが選んだ ' + candName(pick) + ' は、ここまでの答えと食い違ってはいません。'
                + 'ただし ' + candName(state.truth) + ' も同じ答えを返すので、この質問では2つを分けられていませんでした。'));
            var so2 = separatingCard(pick, state.truth);
            if (so2) box.appendChild(p('「' + cardSay(so2) + '」と訊くと、この2つが分かれます。'));
        } else { // missed
            var c0 = g.conflicts[0];
            box.appendChild(p(c0.step + '手目の「' + cardSay(c0.card) + '」に「' + (c0.seen ? 'はい' : 'いいえ')
                + '」と答えました。' + candName(pick) + ' なら、ここは「' + (c0.expected ? 'はい' : 'いいえ') + '」です。'));
        }

        // ★ 各手が何を消したか（§6-6。⚠ ここで初めて出す）
        if (g.steps.length === 0) {
            box.appendChild(p('何も訊かずに答えました。何を見て決めたかを、あとから説明できる形にしておきましょう。', 'note'));
        }
        g.steps.forEach(function (s) {
            var e = document.createElement('div');
            e.className = 'why';
            var b = document.createElement('b');
            b.textContent = s.step + '手目 「' + cardSay(s.card) + '」→ ' + (s.ans ? 'はい' : 'いいえ') + '　';
            e.appendChild(b);
            var w = d.why ? d.why(state.truth, s.card) : '';
            if (w) e.appendChild(document.createTextNode(w));
            var dr = document.createElement('div');
            dr.className = 'drop';
            dr.textContent = s.dropped.length
                ? 'これで ' + s.dropped.map(candName).join('・') + ' が消えました。'
                : 'この質問では、候補は1つも減りませんでした。';
            e.appendChild(dr);
            box.appendChild(e);
        });

        // ★ 割れない組の申し送り（D-A6・§7-4）。⚠ 潰さずに、なぜ割れないかを言う
        var note = d.afterNote ? d.afterNote(state.truth, g) : null;
        if (note) box.appendChild(p(note, 'afternote'));

        box.className = 'result';
        $('answer-choices').className = 'answer hidden';
        $('btn-answer').disabled = true;
        $('after').className = 'after';
        renderCands();
        renderCards();
    }

    // ---------------------------------------------------------------
    // 始める —— ★ 正体は毎回引き直す
    // ---------------------------------------------------------------
    function start(opts) {
        opts = opts || {};
        if (!opts.truth && state.truth) opts.avoid = state.truth;
        var p2 = akiMakeProblem(state.deck, opts);
        state.problem = p2;
        state.truth = p2.truth;
        state.history = [];
        state.answered = false;
        state.marked = {};
        state.record = akiRecord(p2);
        renderAll();
    }

    /** ★ デッキを選ぶ。⚠ 知らない名前・名前なしは既定のデッキ（エラーで止めない） */
    function pickDeck() {
        var id = DEFAULT_DECK;
        try {
            var q = new URLSearchParams(location.search).get('deck');
            if (q && akiDeck(q)) id = q;
        } catch (e) { /* 受け口が壊れても既定で開く */ }
        return akiDeck(id) || akiDeck(DEFAULT_DECK);
    }

    document.addEventListener('DOMContentLoaded', function () {
        state.deck = pickDeck();
        $('btn-answer').addEventListener('click', openAnswer);
        $('btn-new').addEventListener('click', function () { start(); });
        $('btn-again').addEventListener('click', function () { start(); });
        $('q').addEventListener('input', function () {
            state.q = this.value.trim();
            renderCards();
        });
        start();
    });

    // 回帰テスト（tests.js）が iframe の中から駆動するための口。
    // ⚠ 画面の都合で作った窓であって、ここに判定のロジックは置かない（模型は akinator-model.js）
    window.akiUI = {
        state: state,
        start: start,
        ask: ask,
        openAnswer: openAnswer,
        answer: answer,
        setFilter: function (tag, q) { state.tag = tag || ''; state.q = q || ''; renderTags(); renderCards(); }
    };
})();
