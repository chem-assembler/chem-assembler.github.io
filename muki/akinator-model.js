// 色でみる無機化学 — 「かくれた物質をつきとめる」（アキネーター）の模型
//
// DESIGN_akinator.md に従う。⚠⚠ **向きに気をつけること**（§0）:
//
//   アプリ   … 正体を隠して持っている。**学習者の質問に はい／いいえ で答えるだけ**
//   学習者   … **質問を選んで絞り込み、当てる**
//
// ⚠⚠ **アプリは質問を選ばない**（本家アキネーターとは逆向き）。
//   ★ だから「情報量が最大の質問を選ぶ」計算は**出題には使わない**。
//   ★ 使うのは**採点だけ** ——「最短何手で当たるか」（§6）。
//
// 【★★ この模型は候補も質問も知らない】（2026-09-12・ユーザー決定）
//   ⚠⚠ **30件を焼き付けない。** 候補集合と札の束は **デッキ**として外から渡す。
//   ★ 模型が読むのは「候補 × 質問 → はい／いいえ」という形だけで、
//     **答えが表から来るか式から計算されるかを知らない**（設計書 §8-5）。
//   ⇒ ★ 「無機・第1段（30件）」「化学基礎限定」「有機 223件」が、同じ模型の**別のデッキ**になる。
//
//   デッキの形（⚠ これだけが模型との約束）:
//     {
//       id:    'muki1',                       // ★ URL の ?deck= に出る名前
//       name:  '無機・第1段（沈殿とイオン 30件）',
//       cands: [ { id, name, jp, ... }, ... ],        // ⚠ id は一意
//       cards: [ { id, row, tag, say, mean, keys }, ... ],
//       answer: function (candId, cardId) -> true | false,   // ⚠⚠ **必ず二値**（D-A2）
//       why:    function (candId, cardId) -> '…'             // 答え合わせの一文（任意）
//       afterNote: function (truthId, grade) -> '…' | null    // 割れない組の申し送り（任意）
//     }
//
//   ⚠⚠ **答えを null にしない。** 「扱っていない」を第3の答えにすると二値でなくなる（D-A2）。
//   ★ 当てはまらない候補には、**当てはまらないと言い切れる文**を札に書くこと
//     （例:「白色の沈殿ですか」→ Ag⁺ は沈殿ではないので **いいえ**。嘘をついていない）。
//
// 【DOM 非依存】akinator.js（画面）と tests.js（回帰テスト）と node の両方が読む。
//   ここには document も window も出てこない。

'use strict';

// ★ 型の鍵の版。⚠ **札の配り方や採点を変えたら上げること**（集計の単位が変わるため）
var AKI_KEY_VERSION = 'K1';

// ⚠ 積んだ札の中から最小の集合を総当たりで探す上限（§6-2）。
//   ★ 探索の対象は **積んだ札だけ**（パレットの全札ではない）——
//     積んでいない札まで含めると「実は訊かなかったこの1問で1手だった」が出てしまい、
//     「他の解き方」ではなく「別の問題」になる（`assembler/narrowing.js` の M3 と同じ決め）。
var AKI_SUBSET_LIMIT = 16;   // 2^16 = 65,536

// ★ 「理想の最短」を厳密に出す深さ（§6-3。⚠ これを超えたら貪欲で上限を出し、
//   画面には「最短 N手（見つけた中で）」と書く ＝ 嘘をつかない）
var AKI_IDEAL_DEPTH = 3;

// ---------------------------------------------------------------
// デッキ置き場 —— ★ 模型はここに何が入るかを知らない
// ---------------------------------------------------------------
var AKI_DECKS = {};

/** デッキを登録する。⚠ 同じ id は上書き（デッキの差し替えができる形） */
function akiRegisterDeck(deck) {
    AKI_DECKS[deck.id] = deck;
    return deck;
}
function akiDeck(id) { return AKI_DECKS[id] || null; }
function akiDeckIds() { return Object.keys(AKI_DECKS); }

/** デッキの作りが約束どおりか。⚠ 足りないものを**名指しで**返す（黙って動かさない） */
function akiCheckDeck(deck) {
    var bad = [];
    if (!deck) return ['デッキがありません'];
    if (!deck.id) bad.push('id がありません');
    if (!deck.cands || !deck.cands.length) bad.push('候補がありません');
    if (!deck.cards || !deck.cards.length) bad.push('札がありません');
    if (typeof deck.answer !== 'function') bad.push('answer() がありません');
    if (bad.length) return bad;

    var seen = {};
    deck.cands.forEach(function (c) {
        if (seen[c.id]) bad.push('候補の id が重複: ' + c.id);
        seen[c.id] = 1;
    });
    var seenq = {};
    deck.cards.forEach(function (q) {
        if (seenq[q.id]) bad.push('札の id が重複: ' + q.id);
        seenq[q.id] = 1;
        if (!q.say) bad.push('札に say がありません: ' + q.id);
        if (!q.row) bad.push('札に row がありません: ' + q.id);
        if (!q.tag) bad.push('札に tag がありません: ' + q.id);
    });
    // ⚠⚠ **二値であること**（D-A2）。★ null / undefined / 3値を1件でも許さない
    deck.cands.forEach(function (c) {
        deck.cards.forEach(function (q) {
            var a = deck.answer(c.id, q.id);
            if (a !== true && a !== false) {
                bad.push('答えが二値でない: ' + c.id + ' × ' + q.id + ' → ' + a);
            }
        });
    });
    return bad;
}

// ---------------------------------------------------------------
// 基本の問い合わせ
// ---------------------------------------------------------------

function akiCandIds(deck) {
    return deck.cands.map(function (c) { return c.id; });
}
function akiCardIds(deck) {
    return deck.cards.map(function (q) { return q.id; });
}
function akiCand(deck, id) {
    for (var i = 0; i < deck.cands.length; i++) if (deck.cands[i].id === id) return deck.cands[i];
    return null;
}
function akiCard(deck, id) {
    for (var i = 0; i < deck.cards.length; i++) if (deck.cards[i].id === id) return deck.cards[i];
    return null;
}

/** 候補 candId に札 cardId を当てたときの答え。⚠ 必ず true / false */
function akiAnswer(deck, candId, cardId) {
    return deck.answer(candId, cardId) === true;
}

/**
 * これまでの答えと矛盾しない候補。
 * history … [{ card, ans }]（ans は実際に返ってきた答え ＝ 正体の答え）
 */
function akiAlive(deck, history, cands) {
    var list = cands || akiCandIds(deck);
    return list.filter(function (c) {
        return history.every(function (h) {
            return akiAnswer(deck, c, h.card) === (h.ans === true);
        });
    });
}

/** 札 cardId で、いまの候補が「はい」と「いいえ」にどう割れるか */
function akiSplit(deck, cands, cardId) {
    var yes = [], no = [];
    cands.forEach(function (c) {
        (akiAnswer(deck, c, cardId) ? yes : no).push(c);
    });
    return { yes: yes, no: no };
}

/**
 * ★ その札が、いまの候補に対して持つ情報量（bit）。
 * ⚠⚠ **出題には使わない**（アプリは質問を選ばない・§6-4）。
 *   ★ 使うのは答え合わせだけ ——「もっと短い道がありました」を言うため。
 */
function akiBits(deck, cands, cardId) {
    var s = akiSplit(deck, cands, cardId);
    var n = cands.length;
    if (!n) return 0;
    var p = s.yes.length / n, q = s.no.length / n;
    var h = 0;
    if (p > 0) h -= p * Math.log(p) / Math.LN2;
    if (q > 0) h -= q * Math.log(q) / Math.LN2;
    return h;
}

/** 札の集合 cardIds で、候補 a と b が見分けられるか */
function akiSeparates(deck, cardIds, a, b) {
    return cardIds.some(function (q) {
        return akiAnswer(deck, a, q) !== akiAnswer(deck, b, q);
    });
}

/**
 * 配った札では見分けられない組。⚠ **潰すためではなく、名指しして教えるために数える**（D-A6・§7-4）。
 * ★ 「配った札の範囲で割れない」は難易度のつまみであって、欠陥ではない。
 */
function akiUnresolved(deck, cardIds) {
    var cands = akiCandIds(deck), out = [];
    for (var i = 0; i < cands.length; i++) {
        for (var j = i + 1; j < cands.length; j++) {
            if (!akiSeparates(deck, cardIds, cands[i], cands[j])) out.push([cands[i], cands[j]]);
        }
    }
    return out;
}

/** 見分けられない候補どうしを群にまとめる（★ 画面と答え合わせが読む） */
function akiUnresolvedGroups(deck, cardIds) {
    var cands = akiCandIds(deck), used = {}, groups = [];
    cands.forEach(function (a) {
        if (used[a]) return;
        var g = [a];
        cands.forEach(function (b) {
            if (b === a || used[b]) return;
            if (!akiSeparates(deck, cardIds, a, b)) { g.push(b); used[b] = 1; }
        });
        if (g.length > 1) { used[a] = 1; groups.push(g); }
    });
    return groups;
}

// ---------------------------------------------------------------
// 最短手数 —— ★ 定義は `separation-model.js` の `sepAuditProblem().byIon` と同じ（§6-1）
//   「その候補を、他の全候補と見分けられる最小の札の集合の大きさ」
// ---------------------------------------------------------------

/** 札 q が、truth を他のどの候補と分けるか（ビットで持つ） */
function akiCoverMask(deck, truth, others, cardId) {
    var words = new Uint32Array(Math.ceil(others.length / 32));
    var t = akiAnswer(deck, truth, cardId);
    for (var i = 0; i < others.length; i++) {
        if (akiAnswer(deck, others[i], cardId) !== t) words[i >> 5] |= (1 << (i & 31));
    }
    return words;
}
function akiMaskFull(words, n) {
    var need = Math.ceil(n / 32);
    for (var w = 0; w < need; w++) {
        var want = (w === need - 1 && (n & 31)) ? ((1 << (n & 31)) - 1) >>> 0 : 0xFFFFFFFF;
        if ((words[w] >>> 0) !== want) return false;
    }
    return true;
}
function akiMaskCount(words) {
    var n = 0;
    for (var w = 0; w < words.length; w++) {
        var x = words[w] >>> 0;
        while (x) { x &= x - 1; n++; }
    }
    return n;
}

/**
 * ★★ 積んだ札の中から、truth を決めきる最小の集合を総当たりで探す（§6-2）。
 * ⚠⚠ **探索の対象は積んだ札だけ。** 積んでいない札を混ぜたら「別の問題」になる。
 * 返す: { n, sets, exact }（⚠ 決めきれていなければ n は null）
 */
function akiLeastFrom(deck, truth, cardIds) {
    var others = akiCandIds(deck).filter(function (c) { return c !== truth; });
    var n = cardIds.length;
    if (n > AKI_SUBSET_LIMIT) return { n: null, sets: [], exact: false, tooMany: true };
    var masks = cardIds.map(function (q) { return akiCoverMask(deck, truth, others, q); });
    var words = Math.ceil(others.length / 32);
    var best = null, sets = [];
    for (var m = 0; m < (1 << n); m++) {
        var size = 0, x = m;
        while (x) { x &= x - 1; size++; }
        if (best !== null && size > best) continue;
        var acc = new Uint32Array(words);
        for (var i = 0; i < n; i++) {
            if (!(m & (1 << i))) continue;
            for (var w = 0; w < words; w++) acc[w] |= masks[i][w];
        }
        if (!akiMaskFull(acc, others.length)) continue;
        if (best === null || size < best) { best = size; sets = []; }
        if (size === best) {
            var s = [];
            for (var k = 0; k < n; k++) if (m & (1 << k)) s.push(cardIds[k]);
            sets.push(s);
        }
    }
    return { n: best, sets: sets, exact: true, tooMany: false };
}

/**
 * ★ 「理想の最短」—— **デッキの全部の札**を使ってよいとしたときの最小手数（§6-3）。
 * ⚠⚠ 深さ AKI_IDEAL_DEPTH までは悉皆、それを超えたら貪欲で**上限**を出す。
 *   ★ そのとき exact は false ＝ 画面には「最短 N手（見つけた中で）」と書く（嘘をつかない）。
 */
function akiIdeal(deck, truth, cardIds) {
    var cards = cardIds || akiCardIds(deck);
    var others = akiCandIds(deck).filter(function (c) { return c !== truth; });
    if (!others.length) return { n: 0, exact: true, set: [] };
    var words = Math.ceil(others.length / 32);
    var masks = cards.map(function (q) { return akiCoverMask(deck, truth, others, q); });

    // 深さ 1〜AKI_IDEAL_DEPTH の悉皆
    var acc = new Uint32Array(words);
    var idx = [];
    var found = null;
    function rec(start, depth, limit) {
        if (found) return;
        if (depth === limit) {
            if (akiMaskFull(acc, others.length)) {
                found = idx.map(function (i) { return cards[i]; });
            }
            return;
        }
        for (var i = start; i < cards.length && !found; i++) {
            var save = new Uint32Array(acc);
            for (var w = 0; w < words; w++) acc[w] |= masks[i][w];
            idx.push(i);
            rec(i + 1, depth + 1, limit);
            idx.pop();
            acc.set(save);
        }
    }
    for (var d = 1; d <= AKI_IDEAL_DEPTH; d++) {
        acc = new Uint32Array(words);
        idx = [];
        rec(0, 0, d);
        if (found) return { n: found.length, exact: true, set: found };
    }

    // 貪欲（★ 上限しか出さない。⚠ exact:false）
    var cov = new Uint32Array(words), pick = [], guard = 0;
    while (!akiMaskFull(cov, others.length) && guard++ < cards.length) {
        var bestI = -1, bestGain = 0;
        for (var i2 = 0; i2 < cards.length; i2++) {
            if (pick.indexOf(cards[i2]) >= 0) continue;
            var tmp = new Uint32Array(cov);
            for (var w2 = 0; w2 < words; w2++) tmp[w2] |= masks[i2][w2];
            var gain = akiMaskCount(tmp) - akiMaskCount(cov);
            if (gain > bestGain) { bestGain = gain; bestI = i2; }
        }
        if (bestI < 0) break;   // ⚠ これ以上減らせない ＝ 配った札では割れない
        for (var w3 = 0; w3 < words; w3++) cov[w3] |= masks[bestI][w3];
        pick.push(cards[bestI]);
    }
    if (!akiMaskFull(cov, others.length)) return { n: null, exact: false, set: pick };
    return { n: pick.length, exact: false, set: pick };
}

/**
 * デッキ全体の検算。⚠ 決めつけずに数える。
 *   unresolved … 配った札では見分けられない組（★ 潰さない。名指しするために数える）
 *   byCand     … 候補ごとの理想の最短
 *   hardest    … いちばん手数の要る候補
 */
function akiAudit(deck, cardIds) {
    var cards = cardIds || akiCardIds(deck);
    var byCand = {}, worst = 0, unknown = [];
    akiCandIds(deck).forEach(function (c) {
        var r = akiIdeal(deck, c, cards);
        byCand[c] = r;
        if (r.n === null) unknown.push(c);
        else if (r.n > worst) worst = r.n;
    });
    var groups = akiUnresolvedGroups(deck, cards);
    return {
        cards: cards.length,
        cands: deck.cands.length,
        unresolved: akiUnresolved(deck, cards),
        unresolvedGroups: groups,
        byCand: byCand,
        worst: worst,
        undecidable: unknown
    };
}

// ---------------------------------------------------------------
// 出題 —— ★ 毎回つくる（一覧は持たない）。⚠ アプリは質問を選ばない（§0）
// ---------------------------------------------------------------

/**
 * 1問つくる。
 *   opts.truth … ⚠ テストが出題を固定するための口（画面は使わない）
 *   opts.rand  … 乱数（テストが固定するための口）
 *   opts.avoid … ★ 直前の正体。続けて同じものを隠さない
 *   opts.cards … 配る札を絞る（★ 難易度のつまみを後から足すための口）
 */
function akiMakeProblem(deck, opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    var cards = opts.cards ? opts.cards.slice() : akiCardIds(deck);
    var pool = akiCandIds(deck);
    if (opts.avoid && pool.length > 1) {
        var f = pool.filter(function (c) { return c !== opts.avoid; });
        if (f.length) pool = f;
    }
    var truth = opts.truth || pool[Math.floor(rand() * pool.length)];
    return {
        deck: deck.id,
        key: AKI_KEY_VERSION + '|' + deck.id + '|' + cards.length,
        cards: cards,
        truth: truth
    };
}

/**
 * ★ 記録の形（⚠ **持たせるだけ。送信も保存もしない**）。
 *   ★ 集計できる安定した単位は「デッキ ＋ 正体」。⚠ 出題そのものは毎回別物。
 */
function akiRecord(problem, extra) {
    var r = {
        key: problem.key,
        deck: problem.deck,
        truth: problem.truth,
        cards: problem.cards.length
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
}

// ---------------------------------------------------------------
// 採点 —— ★ `sepGrade()` の4区分をそのまま使う（§6-3）
//   'decided'  正解。しかも質問が答えを決めていた
//   'lucky'    正解。⚠ ただし答えと矛盾しない候補が他にも残っていた
//   'missed'   不正解。★ どの答えと食い違うかを名指しできる
//   'unread'   不正解。⚠ 答えとは矛盾しないが、別のほうだった（＝ 質問が足りていない）
// ---------------------------------------------------------------
function akiGrade(deck, truth, picked, history) {
    var alive = akiAlive(deck, history);
    var correct = (picked === truth);
    var pickedAlive = alive.indexOf(picked) >= 0;
    var verdict;
    if (correct) verdict = (alive.length === 1) ? 'decided' : 'lucky';
    else verdict = pickedAlive ? 'unread' : 'missed';

    // ★ 選んだものが、どの答えと食い違うか
    var conflicts = [];
    history.forEach(function (h, i) {
        var mine = akiAnswer(deck, picked, h.card);
        if (mine !== (h.ans === true)) {
            conflicts.push({ step: i + 1, card: h.card, seen: h.ans === true, expected: mine });
        }
    });

    // ★ 各手が何を消したか（⚠ **答え合わせでだけ出す。途中では何も言わない**・§6-6）
    var steps = [], before = akiCandIds(deck);
    history.forEach(function (h, i) {
        var after = akiAlive(deck, history.slice(0, i + 1));
        steps.push({
            step: i + 1, card: h.card, ans: h.ans === true,
            before: before, after: after,
            dropped: before.filter(function (c) { return after.indexOf(c) < 0; })
        });
        before = after;
    });

    return {
        correct: correct, verdict: verdict, alive: alive,
        conflicts: conflicts, steps: steps, truth: truth, picked: picked
    };
}

/**
 * ★★ その回の成績（§6-6）。⚠ 数えるだけ。文面は画面（akinator.js）が組む。
 *   moves       … 実際に訊いた質問の数
 *   least       … ★ **訊いた質問の中から**選び直したときの最小手数（§6-2 の M3 の決め）
 *   ideal       … ★ デッキの札を全部使ってよいときの最小手数（⚠ idealExact が false なら上限）
 *   zero        … 候補を1つも減らさなかった質問（★ `narrowing.js` の「効きが 0」）
 *   minimal     … 決めきっていて、かつ手数が least と同じ ＝ 最短で当てた
 */
function akiScore(deck, truth, history, verdict, grade) {
    var used = history.map(function (h) { return h.card; });
    var lf = akiLeastFrom(deck, truth, used);
    var id = akiIdeal(deck, truth);
    var zero = (grade ? grade.steps : []).filter(function (s) { return s.dropped.length === 0; })
        .map(function (s) { return s.card; });
    return {
        moves: history.length,
        least: lf.n,
        leastSets: lf.sets,
        leastTooMany: !!lf.tooMany,
        ideal: id.n,
        idealExact: id.exact,
        idealSet: id.set,
        zero: zero,
        minimal: verdict === 'decided' && lf.n !== null && history.length === lf.n
    };
}

// node（回帰テストのデータ部分）からも読めるようにする。ブラウザでは何もしない
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        AKI_KEY_VERSION: AKI_KEY_VERSION, AKI_SUBSET_LIMIT: AKI_SUBSET_LIMIT,
        AKI_IDEAL_DEPTH: AKI_IDEAL_DEPTH, AKI_DECKS: AKI_DECKS,
        akiRegisterDeck: akiRegisterDeck, akiDeck: akiDeck, akiDeckIds: akiDeckIds,
        akiCheckDeck: akiCheckDeck, akiCandIds: akiCandIds, akiCardIds: akiCardIds,
        akiCand: akiCand, akiCard: akiCard, akiAnswer: akiAnswer, akiAlive: akiAlive,
        akiSplit: akiSplit, akiBits: akiBits, akiSeparates: akiSeparates,
        akiUnresolved: akiUnresolved, akiUnresolvedGroups: akiUnresolvedGroups,
        akiLeastFrom: akiLeastFrom, akiIdeal: akiIdeal, akiAudit: akiAudit,
        akiMakeProblem: akiMakeProblem, akiRecord: akiRecord,
        akiGrade: akiGrade, akiScore: akiScore
    };
}
