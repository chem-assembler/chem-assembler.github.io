// 色でみる無機化学 — 系統分離モード「型A: すべてのイオンを単離せよ」の模型
//
// DESIGN_separation.md §15-1・§15-2・§16-1・§16-2 に従う。
//
// 【型A は型B と何が違うか】
//   ・中身は **与えられる**（⚠ 推理が無い ＝ 仮説集合 H を持たない。§15-1 の表）
//   ・机上論。⚠ **途中では何も返さない。並べ終えてから答え合わせ**（§16-1）
//   ・採点は **純度** ——「最後に残った各葉に、イオンが1種類だけ入っているか」（§15-2）
//   ・画面は **ツリー**（枝に操作カード・葉にイオンカード）。⚠ 容器が増える画面ではない（§16-2）
//
// 【この模型の芯は Fe³⁺ → Fe²⁺】（§4-3・§15-2）
//   煮沸＋希硝酸を飛ばすと、Fe²⁺ のままアンモニアの段を素通りし、次の段で FeS として沈む。
//   ＝ 第4属の葉に Zn²⁺ と鉄が同居し、鉄の葉は空になる。**単離できていない葉が2つできる**。
//   ⚠ **警告を出さない**（§4-3）。★ 結果を起こして、答え合わせで説明する。
//
// 【型B から借りたもの】
//   SEP_IONS（イオンの名前・炎色）／SEP_COLORS（色名 → hex）／
//   出典の持ち方（ref はデータに残し、画面には出さない。§18-6 (4)）／
//   門番を「毎回の全走で通す」作法（§18-3）。
//   ⚠ **SEP_IONS そのものは書き換えない** —— 型B の抽選の母集団が変わってしまう。
//
// 【DOM 非依存】tree.js（画面）と tests.js（回帰テスト）の両方が読む。

'use strict';

// 型B の模型から借りる（ブラウザでは separation-model.js が先に読まれている前提）
var TREE_BASE = (typeof SEP_IONS !== 'undefined')
    ? { ions: SEP_IONS, colors: SEP_COLORS }
    : (function () { var m = require('./separation-model.js'); return { ions: m.SEP_IONS, colors: m.SEP_COLORS }; })();

// ---------------------------------------------------------------
// 色 —— ★ 型B の表をそのまま使い、型A だけに要るものを足す
//   （⚠ SEP_COLORS 自体は書き換えない。型B の検査がその中身を数えている）
// ---------------------------------------------------------------
var TREE_COLORS = (function () {
    var c = {};
    Object.keys(TREE_BASE.colors).forEach(function (k) { c[k] = TREE_BASE.colors[k]; });
    c['緑白色'] = '#cfe8d0';     // Fe(OH)₂。⚠ 型B の札では出番が無かった色
    return c;
})();

// ---------------------------------------------------------------
// イオン
//   ⚠ **酸化数で分ける**（§4-4）。Fe³⁺ と Fe²⁺ は別の化学種。
//   ★ ただし「葉に1種類だけか」を数えるときは **元素** で見る
//     （鉄は Fe³⁺ で入って FeS で出ることがある。それでも鉄は鉄）。
// ---------------------------------------------------------------
var TREE_EXTRA_IONS = {
    Fe2: { id: 'Fe2', name: 'Fe²⁺', jp: '鉄(II)イオン', flame: null }
};

function treeIon(id) { return TREE_BASE.ions[id] || TREE_EXTRA_IONS[id] || null; }

/** 元素（★ 純度を数える単位）。Fe³⁺ も Fe²⁺ も「鉄」 */
function treeElement(id) { return (id === 'Fe2' || id === 'Fe3') ? 'Fe' : id; }

/** 元素の呼び名（答え合わせで使う） */
var TREE_ELEMENT_JP = { Ag: '銀', Cu: '銅', Fe: '鉄', Zn: '亜鉛', Ca: 'カルシウム', Na: 'ナトリウム' };

/**
 * 属（§10-2 で「属」に決まっている。⚠ 教科書は「操作1〜5」なので画面の札には出さない。
 * ★ 出すのは答え合わせだけ）。
 */
var TREE_GROUP = { Ag: 1, Cu: 2, Fe: 3, Zn: 4, Ca: 5, Na: 6 };

// ---------------------------------------------------------------
// 容器の液性（★ **状態として持つ**。⚠ 札の中に閉じ込めない）
//
// 【⚠ なぜ状態なのか】（2026-08-28・ユーザー指摘で作り直した）
//   はじめの実装は硫化水素の札を「酸性」「塩基性」の2枚に割っていた。
//   ⚠ そうすると **希塩酸を置かずに硫化水素を置いても結果が変わらない** ——
//   ★ 型A は「手順を組む」ことが問われる型なので、順番が結果に効かないと問い自体が痩せる。
//   ✅ 札は **硫化水素1枚**にして、そのときの容器の液性で結果が変わる形に戻した（§2-2）。
//
// ★ 何もしていない最初の状態は **中性**（'neutral'）と呼ぶ。
//   ⚠ 厳密には金属イオンの加水分解でわずかに酸性に寄るが、
//   ★ この教材が扱う分岐は教科書の硫化物の表（**酸性 ／ 中性・塩基性**）そのもので、
//     その表の語彙が3つ（酸性・中性・塩基性）しかない。
//     ⚠ 「未調整」のような表にない第4の語を作ると、どの列を引くのかが読めなくなる。
// ---------------------------------------------------------------
var TREE_PH_JP = { neutral: '中性', acid: '酸性', base: '塩基性' };

/** ★ 悉皆の検査が回す容器の状態（液性3 × 硫化水素の残り2 ＝ 6通り） */
var TREE_ENVS = (function () {
    var out = [];
    ['neutral', 'acid', 'base'].forEach(function (ph) {
        [false, true].forEach(function (h) { out.push({ ph: ph, h2s: h }); });
    });
    return out;
})();

// ---------------------------------------------------------------
// 操作の札
//   splits … ★ **その操作が沈殿をつくりうるか**。⚠ 状態ではなく札の性質として持つ。
//            煮沸と希硝酸は何も沈めない ＝ 枝に置いても葉が生えない。
//            ★ これが §13-4c の「分ける札」と、それ以外の区別にあたる。
//   ph    … ★ **その札が容器の液性をどう変えるか**（⚠ 変えない札は持たない）。
//   reuse … ⚠ **手札に残る札**。★ 硫化水素は教科書の手順で2度通す（操作2と操作4）ので、
//           1枚の札を2つの枝に置けなければならない。
//   ⚠ 札の名前に属の番号を書かない —— 書いたら並べる順を配ってしまう。
// ---------------------------------------------------------------
var TREE_OPS = {
    hcl: {
        id: 'hcl', short: '希塩酸', splits: true, ph: 'acid',
        say: '希塩酸を加える',
        mean: '塩化物が水に溶けにくいイオンを沈殿させる'
    },
    h2s: {
        // ★★ 1枚だけ。⚠ 液性で結果が変わる（＝ 液性は容器が持つ）
        id: 'h2s', short: '硫化水素', splits: true, reuse: true,
        say: '硫化水素を通す',
        mean: '硫化物が水に溶けにくいイオンを沈殿させる'
    },
    boil: {
        id: 'boil', short: '煮沸', splits: false,
        say: '煮沸する',
        mean: '溶けている硫化水素を追い出す'
    },
    hno3: {
        id: 'hno3', short: '希硝酸', splits: false, ph: 'acid',
        say: '希硝酸を加えて加熱する',
        mean: '酸化剤としてはたらく'
    },
    nh3: {
        id: 'nh3', short: 'アンモニア水', splits: true, ph: 'base',
        say: '塩化アンモニウムを加えてから、アンモニア水を十分に加える',
        mean: 'NH₄⁺ を共存させて OH⁻ を薄く保ったまま、塩基性にする'
    },
    co3: {
        id: 'co3', short: '炭酸アンモニウム', splits: true, ph: 'base',
        say: '炭酸アンモニウム水溶液を加える',
        mean: '炭酸塩が水に溶けにくいイオンを沈殿させる'
    }
};

// ---------------------------------------------------------------
// 反応の表（⚠ **イオン × 札を悉皆で宣言する**。§4-1）
//
//   ppt  … 沈殿するか
//   f    … 沈殿の化学式／c … 沈殿の色
//   to   … ★ **化学種が変わる**（Fe³⁺ ⇄ Fe²⁺）。⚠ 酸化数を持たないと、この設計は成立しない（§4-4）
//   turb … 沈殿ではない濁り（硫黄）。★ 見えるが、イオンは容器に残る
//   byPh … ★★ **容器の液性で結果が分かれる**（⚠ 硫化水素の札だけ）。
//          `acid` … 酸性の容器 ／ `other` … 中性・塩基性の容器
//          ⚠ 教科書の硫化物の表が「酸性 ／ 中性・塩基性」の2列なので、この2つで足りる。
//   whenH2s … ⚠ **溶けている硫化水素が残っているときの差し替え**。
//          ★ これが「煮沸してから硝酸」の *煮沸* の側の理由（W4・§10-4）
//   ref  … 出典。⚠⚠ **画面には出さない**（§18-6 (4)）。データに残すのは §4-1 の線を後から検算するため
//   src  … 'この教材' ＝ ⚠ **資料が直接は書いていない、こちらが埋めた組**。
//          ★ 系統分離の順どおりに進めば通らない場所（＝ 出番のあとまで残っていた場合）だけに出る。
//          回帰テストがこの件数を見張っている。
// ---------------------------------------------------------------
var TREE_RULES = {
    Ag: {
        hcl: { ppt: true, f: 'AgCl', c: '白色', why: '銀イオンが塩化物イオンと結びついて AgCl になり、水に溶けないので沈む', ref: '教科書 p.88 表1' },
        h2s: {
            byPh: {
                acid: { ppt: true, f: 'Ag₂S', c: '黒色', why: 'Ag₂S は酸性でも沈殿する', ref: '教科書 p.96' },
                other: { ppt: true, f: 'Ag₂S', c: '黒色', why: 'Ag₂S は液性によらず沈殿する', ref: '教科書 p.96' }
            }
        },
        boil: { ppt: false, why: '煮沸しても銀イオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えても銀イオンは変わらない' },
        nh3: { ppt: false, why: 'いったん褐色の Ag₂O ができるが、過剰のアンモニア水で [Ag(NH₃)₂]⁺ になって溶ける', ref: '教科書 p.90 式(10)' },
        co3: { ppt: false, src: 'この教材', why: '炭酸アンモニウムの液にはアンモニアが含まれるので、銀イオンは [Ag(NH₃)₂]⁺ になって溶けたまま残る' }
    },
    Cu: {
        hcl: { ppt: false, why: '塩化銅(II) は水に溶けるので沈殿しない' },
        h2s: {
            byPh: {
                acid: { ppt: true, f: 'CuS', c: '黒色', why: 'CuS は酸性でも沈殿する', ref: '教科書 p.88 表2・p.96' },
                other: { ppt: true, f: 'CuS', c: '黒色', why: 'CuS は液性によらず沈殿する', ref: '教科書 p.96' }
            }
        },
        boil: { ppt: false, why: '煮沸しても銅(II)イオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えても銅(II)イオンは変わらない' },
        nh3: { ppt: false, why: 'いったん青白色の Cu(OH)₂ ができるが、過剰のアンモニア水で深青色の [Cu(NH₃)₄]²⁺ になって溶ける', ref: '教科書 p.90 式(4)(9)' },
        co3: { ppt: false, src: 'この教材', why: '炭酸アンモニウムの液にはアンモニアが含まれるので、銅(II)イオンは [Cu(NH₃)₄]²⁺ になって溶けたまま残る' }
    },
    Fe3: {
        hcl: { ppt: false, why: '塩化鉄(III) は水に溶けるので沈殿しない' },
        h2s: {
            byPh: {
                // ⚠⚠ この教材の芯。★ 酸性では鉄は沈まず、**Fe²⁺ に変わってろ液に残る**
                acid: {
                    ppt: false, to: 'Fe2', turb: { c: '淡黄色', f: 'S' },
                    why: '硫化水素が還元剤としてはたらいて Fe³⁺ が Fe²⁺ になる。酸化された硫黄が淡黄色の濁りとして出るが、鉄そのものはろ液に残る',
                    ref: '教科書 p.83'
                },
                // ⚠ 酸性でない容器に通すと、還元されたうえで硫化物として沈んでしまう
                other: {
                    ppt: true, to: 'Fe2', f: 'FeS', c: '黒色', src: 'この教材',
                    why: '硫化水素が還元剤としてはたらいて Fe²⁺ になり、酸性ではないので FeS として沈む'
                }
            }
        },
        boil: { ppt: false, why: '煮沸しても鉄(III)イオンは変わらない' },
        hno3: { ppt: false, why: '鉄はすでに Fe³⁺ なので、希硝酸を加えても変わらない' },
        nh3: { ppt: true, f: 'FeO(OH)', c: '赤褐色', why: 'FeO(OH) は OH⁻ が薄くてもよく沈むので、この段で赤褐色の沈殿になる', ref: '教科書 p.90 式(3)' },
        co3: { ppt: true, f: 'FeO(OH)', c: '赤褐色', src: 'この教材', why: '炭酸アンモニウムの液は塩基性なので、まだ残っていた鉄(III)イオンはここで水酸化物として沈む' }
    },
    Fe2: {
        hcl: { ppt: false, why: '塩化鉄(II) は水に溶けるので沈殿しない' },
        h2s: {
            byPh: {
                acid: { ppt: false, why: 'FeS は酸性では沈殿しない', ref: '教科書 p.96' },
                other: { ppt: true, f: 'FeS', c: '黒色', why: 'FeS は中性・塩基性で沈殿する', ref: '教科書 p.96' }
            }
        },
        boil: { ppt: false, why: '煮沸しても鉄(II)イオンは変わらない' },
        hno3: {
            ppt: false, to: 'Fe3',
            why: '希硝酸が酸化剤としてはたらいて、Fe²⁺ が Fe³⁺ に戻る',
            ref: '教科書 p.83',
            // ⚠ 煮沸していない容器に硝酸を入れても戻りきらない（§4-2 の決め）
            whenH2s: { ppt: false, why: '溶けている硫化水素が残っているので、希硝酸を加えても Fe²⁺ は Fe³⁺ に戻りきらない' }
        },
        nh3: {
            // ★★ 芯。Fe(OH)₂ は FeO(OH) ほど沈みやすくないので、この段では沈まない
            ppt: false,
            why: 'Fe(OH)₂ は FeO(OH) ほど沈みやすくないので、OH⁻ を薄く保ったこの段では沈まずに素通りする',
            // W4（§10-4）: 煮沸していないと、塩基性になった時点で硫化物が混ざる
            whenH2s: { ppt: true, f: 'FeS', c: '黒色', why: '溶けている硫化水素を追い出していないので、塩基性になった時点で FeS が沈み、この段の沈殿に混ざる' }
        },
        co3: { ppt: true, f: 'Fe(OH)₂', c: '緑白色', src: 'この教材', why: '炭酸アンモニウムの液は塩基性なので、まだ残っていた鉄(II)イオンはここで水酸化物として沈む' }
    },
    Zn: {
        hcl: { ppt: false, why: '塩化亜鉛は水に溶けるので沈殿しない' },
        h2s: {
            byPh: {
                acid: { ppt: false, why: 'ZnS は中性・塩基性でできる沈殿で、酸性では沈殿しない', ref: '教科書 p.96' },
                other: { ppt: true, f: 'ZnS', c: '白色', why: 'ZnS は中性・塩基性で沈殿する', ref: '教科書 p.96' }
            }
        },
        boil: { ppt: false, why: '煮沸しても亜鉛イオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えても亜鉛イオンは変わらない' },
        nh3: {
            ppt: false,
            why: 'いったん白色の Zn(OH)₂ ができるが、過剰のアンモニア水で無色の [Zn(NH₃)₄]²⁺ になって溶ける',
            ref: '教科書 p.90 式(8)',
            whenH2s: { ppt: true, f: 'ZnS', c: '白色', why: '溶けている硫化水素を追い出していないので、塩基性になった時点で ZnS が沈み、この段の沈殿に混ざる' }
        },
        co3: { ppt: false, src: 'この教材', why: '炭酸アンモニウムの液にはアンモニアが含まれるので、亜鉛イオンは [Zn(NH₃)₄]²⁺ になって溶けたまま残る' }
    },
    Ca: {
        hcl: { ppt: false, why: '塩化カルシウムは水に溶けるので沈殿しない' },
        h2s: { ppt: false, why: 'カルシウムは硫化物の沈殿をつくらない', ref: '教科書 p.96' },
        boil: { ppt: false, why: '煮沸してもカルシウムイオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えてもカルシウムイオンは変わらない' },
        nh3: { ppt: false, why: 'NH₄⁺ を共存させて OH⁻ を薄く保っているので、カルシウムの水酸化物は沈まない', ref: '教科書 p.90' },
        co3: { ppt: true, f: 'CaCO₃', c: '白色', why: 'カルシウムイオンが炭酸イオンと結びついて CaCO₃ になり、水に溶けないので沈む', ref: '教科書 p.90 式(11)' }
    },
    Na: {
        hcl: { ppt: false, why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        h2s: { ppt: false, why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        boil: { ppt: false, why: '煮沸してもナトリウムイオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えてもナトリウムイオンは変わらない' },
        nh3: { ppt: false, why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        co3: { ppt: false, why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' }
    }
};

/**
 * 1組の規則を引く。⚠ 表に無い組は null（＝ 宣言もれ。門番が落とす）
 * @param env ★ **容器の状態** `{ ph: 'neutral'|'acid'|'base', h2s: 溶けている硫化水素が残っているか }`
 *            ⚠ 液性を札の中に閉じ込めず、ここで初めて突き合わせる（2026-08-28 の作り直し）
 */
function treeRule(ionId, opId, env) {
    var row = TREE_RULES[ionId];
    if (!row || !row[opId]) return null;
    var base = row[opId];
    env = env || {};
    // ★ 液性で分かれる札（＝ 硫化水素）。⚠ 中性と塩基性は教科書の表で同じ列
    if (base.byPh) {
        base = base.byPh[env.ph === 'acid' ? 'acid' : 'other'];
        if (!base) return null;
    }
    if (env.h2s && base.whenH2s) {
        // ⚠ 差し替えるのは結果だけ。出典は元の行のものを引き継ぐ
        var merged = { ref: base.ref, src: base.src };
        Object.keys(base.whenH2s).forEach(function (k) { merged[k] = base.whenH2s[k]; });
        return merged;
    }
    return base;
}

// ---------------------------------------------------------------
// 走らせる —— ★ **これが「アプリが実際に走らせた結果」**（§16-1 の答え合わせの片側）
//   ⚠ 途中では何も返さない。返すのは並べ終えたあとの全体だけ。
// ---------------------------------------------------------------

/**
 * @param ions  容器の中身（★ 与えられている。推理は無い）
 * @param seq   枝に置かれた操作の列。⚠ **空の枝は飛ばす**（null が混ざってよい）
 * @returns { stages, rest, feAsFeS }
 *   stages[i] = { slot, op, splits, ppt:[{ion, from, f, c, why}], changes, turb, left:[ion] }
 *   rest      = 最後まで溶けたまま残ったイオン（＝ 最後のろ液の葉）
 *
 * ⚠ `changes` は **沈まなかったが化学種が変わったもの**（Fe³⁺ ⇄ Fe²⁺）。
 *   ★ これを持たないと、答え合わせが「その手で何が起きたか」を言えない
 *     —— 溶けている側の説明を *操作のあとの状態* から引くと、
 *     「希硝酸を加えた」手の説明が「鉄はすでに Fe³⁺ なので変わらない」になってしまう（実機で踏んだ）。
 */
function treeRun(ions, seq) {
    var present = ions.slice();
    var h2s = false;
    var ph = 'neutral';     // ★ 何もしていない容器の液性（§ 上の TREE_PH_JP のコメント）
    var stages = [];
    var feAsFeS = false;

    seq.forEach(function (opId, slot) {
        if (!opId) {
            stages.push({ slot: slot, op: null, splits: false, ppt: [], ph: ph, phAfter: ph, left: present.slice() });
            return;
        }
        var op = TREE_OPS[opId];
        var before = present.slice();
        var phBefore = ph;
        var ppt = [], next = [], turb = null, changes = [], stayWhy = [];
        present.forEach(function (ionId) {
            var r = treeRule(ionId, opId, { ph: ph, h2s: h2s });
            if (!r) { next.push(ionId); return; }        // ⚠ 宣言もれ。門番が別途落とす
            var become = r.to || ionId;
            if (r.turb) turb = { c: r.turb.c, f: r.turb.f };
            if (r.ppt) {
                if (r.f === 'FeS') feAsFeS = true;
                ppt.push({ ion: become, from: ionId, f: r.f, c: r.c, why: r.why, src: r.src });
            } else {
                if (become !== ionId) changes.push({ from: ionId, to: become, why: r.why });
                else stayWhy.push({ ion: ionId, why: r.why });
                next.push(become);
            }
        });
        // 操作そのものが状態に効く（★ 溶けている硫化水素が残っているか・★★ 容器の液性）
        var h2sBefore = h2s;
        if (opId === 'h2s') h2s = true;
        if (opId === 'boil') { h2s = false; if (h2sBefore) changes.push({ from: null, to: null, why: '溶けていた硫化水素が追い出された' }); }
        if (op.ph && op.ph !== ph) {
            ph = op.ph;
            changes.push({ from: null, to: null, why: '容器は' + TREE_PH_JP[ph] + 'になった' });
        }
        present = next;
        stages.push({
            slot: slot, op: opId, splits: op.splits, ppt: ppt,
            changes: changes, stayWhy: stayWhy, turb: turb,
            ph: phBefore, phAfter: ph,
            before: before, left: present.slice()
        });
    });

    return { stages: stages, rest: present.slice(), feAsFeS: feAsFeS };
}

/** 葉の id。★ 枝 slot の沈殿側は 'L<slot>'、いちばん下のろ液は 'F' */
function treeLeafId(slot) { return 'L' + slot; }
var TREE_FINAL_LEAF = 'F';

/** 実際に走らせた結果を「葉 → 元素の列」にたたむ（★ 純度を数える単位は元素） */
function treeActualLeaves(run) {
    var out = {};
    run.stages.forEach(function (s) {
        if (!s.op || !s.splits) return;
        out[treeLeafId(s.slot)] = s.ppt.map(function (e) { return treeElement(e.ion); });
    });
    out[TREE_FINAL_LEAF] = run.rest.map(treeElement);
    return out;
}

// ---------------------------------------------------------------
// 採点 —— ★★ **純度**。⚠ 仮説を一切使わずに書ける（§15-2）
// ---------------------------------------------------------------

/**
 * @param problem { ions, ops }
 * @param seq     枝に置かれた操作の列（null 可）
 * @param plan    ★ 本人の机上。{ ionId: leafId }。⚠ 置いていないイオンは入っていない
 * @returns 採点
 *   impure       … ⚠ 実際に2種類以上のイオンが来た葉（＝ 単離できていない）
 *   emptyPlanned … ⚠ 本人がイオンを置いたのに、実際には何も来なかった葉
 *   dirty        … ★ **単離できていない葉の数** ＝ impure + emptyPlanned（⚠ これが数えるもの）
 *   misplaced    … 机上と実際で行先が違ったイオン
 *   unplaced     … 机上でどこにも置かなかったイオン
 *   isolated     … 実際に全部が別々の葉に1つずつ入ったか
 *   matched      … 机上と実際が完全に一致したか
 */
function treeGrade(problem, seq, plan) {
    var run = treeRun(problem.ions, seq);
    var actual = treeActualLeaves(run);

    // 葉の一覧（★ 実在する葉だけ。⚠ 操作が置かれていない枝には葉が無い）
    var leaves = [];
    run.stages.forEach(function (s) { if (s.op && s.splits) leaves.push(treeLeafId(s.slot)); });
    leaves.push(TREE_FINAL_LEAF);

    var planned = {};
    leaves.forEach(function (l) { planned[l] = []; });
    var unplaced = [];
    problem.ions.forEach(function (ionId) {
        var l = plan[ionId];
        if (!l || leaves.indexOf(l) < 0) { unplaced.push(ionId); return; }
        planned[l].push(treeElement(ionId));
    });

    var impure = [], emptyPlanned = [], rows = [];
    leaves.forEach(function (l) {
        var a = (actual[l] || []).slice(), p = planned[l].slice();
        if (a.length >= 2) impure.push(l);
        if (a.length === 0 && p.length >= 1) emptyPlanned.push(l);
        rows.push({ leaf: l, actual: a, planned: p, same: a.slice().sort().join(',') === p.slice().sort().join(',') });
    });

    var misplaced = [];
    problem.ions.forEach(function (ionId) {
        var el = treeElement(ionId);
        var where = null;
        leaves.forEach(function (l) { if ((actual[l] || []).indexOf(el) >= 0) where = l; });
        var said = plan[ionId] || null;
        if (said && said !== where) misplaced.push({ ion: ionId, said: said, actual: where });
    });

    var isolated = leaves.every(function (l) { return (actual[l] || []).length <= 1; }) &&
        problem.ions.every(function (ionId) {
            var el = treeElement(ionId);
            return leaves.some(function (l) { return (actual[l] || []).indexOf(el) >= 0; });
        });
    var matched = rows.every(function (r) { return r.same; }) && unplaced.length === 0;

    var verdict;
    if (!isolated) verdict = 'notIsolated';
    else if (matched) verdict = 'perfect';
    else verdict = 'misread';

    return {
        run: run, actual: actual, leaves: leaves, rows: rows,
        impure: impure, emptyPlanned: emptyPlanned,
        dirty: impure.length + emptyPlanned.length,
        misplaced: misplaced, unplaced: unplaced,
        isolated: isolated, matched: matched, verdict: verdict,
        feAsFeS: run.feAsFeS
    };
}

// ---------------------------------------------------------------
// 出題
//   ⚠ 型A は中身が既知なので、型B のような「見分けられるか」の門番は要らない。
//   ★ 代わりに門番が見るのは **「配った札で、全部を単離しきる手順が実在するか」**。
//     ⚠ 実在しない出題は解けない ＝ 出してはいけない（§2-4 の型A 版）。
// ---------------------------------------------------------------

// ★ 教科書の分属の順（＝ 模範解答）。⚠ 画面には出さない。門番と答え合わせだけが読む
//   ⚠ **硫化水素が2度出てくる**（教科書の操作2＝酸性の容器・操作4＝塩基性の容器）。
//   ★ 札は1枚で、容器の液性が違うから結果が違う ＝ だから同じ札を2つの枝に置く。
var TREE_STANDARD_ORDER = ['hcl', 'h2s', 'boil', 'hno3', 'nh3', 'h2s', 'co3'];

var TREE_MODES = {
    // ⚠ 名前はユーザーが決めた文言（2026-08-28）。★ 「行先」であって「行き先」ではない
    read: { id: 'read', name: 'イオンの行先を答える', mark: '★☆☆', preset: true },
    build: { id: 'build', name: '実験手順から考える', mark: '★★☆', preset: false }
};

// ⚠ 出題の説明文を持たせない（§18-6 (1)）。★ 解き筋を先に配ることになる。
//   画面に出してよいのは **難易度の印と、中身のイオン**だけ。
var TREE_PROBLEMS = [
    {
        id: 'a1',
        ions: ['Ag', 'Cu', 'Fe3', 'Zn', 'Ca', 'Na'],
        ops: ['hcl', 'h2s', 'boil', 'hno3', 'nh3', 'co3']
    },
    {
        id: 'a2',
        // ⚠ 亜鉛が居ない。★ 鉄を戻し忘れても葉は汚れないが、行先は変わる
        //   （＝ 純度と一致・不一致が別のものだと分かる題材）
        ions: ['Ag', 'Cu', 'Fe3', 'Ca', 'Na'],
        ops: ['hcl', 'h2s', 'boil', 'hno3', 'nh3', 'co3']
    },
    {
        id: 'a3',
        // ⚠ カルシウムが居ない ＝ 炭酸アンモニウムは何も沈めない。
        //   ★ 配られた札を全部使う必要はない、を体験させる
        ions: ['Ag', 'Cu', 'Fe3', 'Zn', 'Na'],
        ops: ['hcl', 'h2s', 'boil', 'hno3', 'nh3', 'co3']
    }
];

/** 模範の手順（★ 配られた札を、教科書の順に並べたもの） */
function treeIdealSeq(problem) {
    return TREE_STANDARD_ORDER.filter(function (o) { return problem.ops.indexOf(o) >= 0; });
}

/**
 * 枝の数。⚠ **配った札の枚数ではない** ——
 * ★ 硫化水素は1枚の札を2つの枝に置くので、札 6 枚に対して枝は 7 本になる。
 */
function treeSlotCount(problem) { return treeIdealSeq(problem).length; }

/** 空の机上（＝ 何も置いていない） */
function treeEmptyPlan() { return {}; }

/** 実際に走らせた結果から、机上を起こす（★ やさしい段の答え合わせ・門番が使う） */
function treePlanFromRun(problem, seq) {
    var run = treeRun(problem.ions, seq);
    var actual = treeActualLeaves(run);
    var plan = {};
    problem.ions.forEach(function (ionId) {
        var el = treeElement(ionId);
        Object.keys(actual).forEach(function (l) {
            if (actual[l].indexOf(el) >= 0) plan[ionId] = l;
        });
    });
    return plan;
}

/**
 * 出題の門番（§2-4 の型A 版）。⚠ 決めつけずに数える。
 *   undeclared … 宣言もれ（イオン × 札）。⚠ 1件でもあれば出題データの不備
 *   solvable   … ★ 配った札で、全部を単離しきる手順が実在するか
 *   idealDirty … 模範の手順で単離できていない葉の数（★ 0 でなければ出題が壊れている）
 *   feTrap     … ⚠ **希硝酸を抜いたときに、実際に結果が変わるか**
 *                （★ この教材の芯が効く題材かどうか。§15-2）
 *   feDirty    … その答案で単離できていない葉が何枚できるか
 *   hclTrap    … ★★ **希塩酸を抜いたときに、実際に結果が変わるか**
 *                （⚠ 酸性にせずに硫化水素を通すと、酸性では沈まない硫化物まで沈む）
 */
function treeAuditProblem(p) {
    var undeclared = [];
    p.ions.concat(['Fe2']).forEach(function (c) {
        if (!TREE_RULES[c]) { undeclared.push(c + '×*'); return; }
        // ★ 悉皆は **容器の状態ぜんぶ**（液性3 × 硫化水素の残り2）で見る
        p.ops.forEach(function (o) {
            TREE_ENVS.forEach(function (env) {
                if (!treeRule(c, o, env)) undeclared.push(c + '×' + o + '(' + env.ph + (env.h2s ? '+h2s' : '') + ')');
            });
        });
    });

    var ideal = treeIdealSeq(p);
    var idealGrade = treeGrade(p, ideal, treePlanFromRun(p, ideal));

    // ⚠ 芯が効くか ＝ 希硝酸を抜いた答案が、模範と違う結果になるか
    // ★ **枝は空けたまま抜く**（詰めない）。⚠ 詰めると葉の番号がずれて、
    //   「机上と実際の食い違い」ではなく「番号のずれ」を数えてしまう
    var noHno3 = ideal.map(function (o) { return o === 'hno3' ? null : o; });
    var trapGrade = treeGrade(p, noHno3, treePlanFromRun(p, ideal));
    var feTrap = trapGrade.dirty > 0 || trapGrade.misplaced.length > 0;

    // ★★ 液性が状態として効いているか ＝ 希塩酸を抜くと硫化水素の結果が変わるか
    //   ⚠ 札の中に液性を閉じ込めていたら、ここは何も変わらない（＝ この検査が落ちる）
    var noHcl = ideal.map(function (o) { return o === 'hcl' ? null : o; });
    var hclGrade = treeGrade(p, noHcl, treePlanFromRun(p, ideal));
    var idealLeaves = treeActualLeaves(treeRun(p.ions, ideal));
    var noHclLeaves = treeActualLeaves(treeRun(p.ions, noHcl));
    var hclTrap = JSON.stringify(idealLeaves) !== JSON.stringify(noHclLeaves);

    return {
        id: p.id,
        undeclared: undeclared,
        ideal: ideal,
        idealDirty: idealGrade.dirty,
        solvable: idealGrade.isolated,
        feTrap: feTrap,
        feDirty: trapGrade.dirty,
        feMisplaced: trapGrade.misplaced.length,
        hclTrap: hclTrap,
        hclDirty: hclGrade.dirty,
        ok: undeclared.length === 0 && idealGrade.isolated && idealGrade.dirty === 0
    };
}

/** 出題を1件引く */
function treeProblem(id) {
    var hit = TREE_PROBLEMS.filter(function (p) { return p.id === id; });
    return hit.length ? hit[0] : TREE_PROBLEMS[0];
}

/**
 * ★ 型の鍵（型B の §18-6 (3) と同じ作法）。⚠ 送信も保存もしない。持つだけ。
 * 版を 'A1' にしてある。⚠ 札の配り方か採点を変えたら上げること
 */
// ⚠ A1 → A2（2026-08-28）: 硫化水素の札を2枚から1枚にし、液性を容器の状態にした。
//   ★ 同じ中身でも問いの意味が変わったので、古い型と混ぜて数えてはいけない。
var TREE_KEY_VERSION = 'A2';
function treeTypeKey(modeId, problem) {
    return TREE_KEY_VERSION + '|' + modeId + '|' + problem.ions.slice().sort().join('-');
}

function treeRecord(modeId, problem, extra) {
    var r = {
        key: treeTypeKey(modeId, problem),
        mode: modeId,
        ions: problem.ions.slice(),
        ops: problem.ops.slice()
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
}

// node からも読めるようにする。ブラウザでは何もしない
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TREE_COLORS: TREE_COLORS, TREE_OPS: TREE_OPS, TREE_RULES: TREE_RULES,
        TREE_PROBLEMS: TREE_PROBLEMS, TREE_MODES: TREE_MODES, TREE_GROUP: TREE_GROUP,
        TREE_ELEMENT_JP: TREE_ELEMENT_JP, TREE_STANDARD_ORDER: TREE_STANDARD_ORDER,
        TREE_FINAL_LEAF: TREE_FINAL_LEAF, TREE_KEY_VERSION: TREE_KEY_VERSION,
        TREE_PH_JP: TREE_PH_JP, TREE_ENVS: TREE_ENVS, treeSlotCount: treeSlotCount,
        treeIon: treeIon, treeElement: treeElement, treeRule: treeRule,
        treeRun: treeRun, treeLeafId: treeLeafId, treeActualLeaves: treeActualLeaves,
        treeGrade: treeGrade, treeIdealSeq: treeIdealSeq, treeEmptyPlan: treeEmptyPlan,
        treePlanFromRun: treePlanFromRun, treeAuditProblem: treeAuditProblem,
        treeProblem: treeProblem, treeTypeKey: treeTypeKey, treeRecord: treeRecord
    };
}
