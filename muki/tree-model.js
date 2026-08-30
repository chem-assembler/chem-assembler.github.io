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
    // ★★ 沈殿を酸に溶かしたときの「溶けた姿」の色（2026-08-30・第5属を入れた回）。
    //   ⚠ 溶液の色なので、沈殿の色の表には無かった（教科書 p.66 図1 のイオンの色）
    c['淡緑色'] = '#bfe3c8';     // Fe²⁺(aq)
    c['黄褐色'] = '#c8912f';     // Fe³⁺(aq)
    return c;
})();

// ---------------------------------------------------------------
// イオン
//   ⚠ **酸化数で分ける**（§4-4）。Fe³⁺ と Fe²⁺ は別の化学種。
//   ★ ただし「葉に1種類だけか」を数えるときは **元素** で見る
//     （鉄は Fe³⁺ で入って FeS で出ることがある。それでも鉄は鉄）。
// ---------------------------------------------------------------
//   ⚠⚠ **SEP_IONS には足さない**（型B の抽選の母集団と問題 ID が動いてしまう）。
//     ★ 型A だけが要るイオンは、ここに置く。
var TREE_EXTRA_IONS = {
    Fe2: { id: 'Fe2', name: 'Fe²⁺', jp: '鉄(II)イオン', flame: null },
    // ★★ 第5属のもう1つ（2026-08-30）。⚠ Ca²⁺ と同じ段（炭酸アンモニウム）で沈むので、
    //   **属の中で割る**必要が出る。★ 炎色は持つが、それは「分ける札」ではない（§13-4b）
    Ba: {
        id: 'Ba', name: 'Ba²⁺', jp: 'バリウムイオン',
        flame: { names: ['黄緑色'], ref: '教科書 p.88 図1' }
    }
};

function treeIon(id) { return TREE_BASE.ions[id] || TREE_EXTRA_IONS[id] || null; }

/** 元素（★ 純度を数える単位）。Fe³⁺ も Fe²⁺ も「鉄」 */
function treeElement(id) { return (id === 'Fe2' || id === 'Fe3') ? 'Fe' : id; }

/** 元素の呼び名（答え合わせで使う） */
var TREE_ELEMENT_JP = {
    Ag: '銀', Pb: '鉛', Cu: '銅', Fe: '鉄', Al: 'アルミニウム',
    Zn: '亜鉛', Ca: 'カルシウム', Ba: 'バリウム', Na: 'ナトリウム'
};

/**
 * 属（§10-2 で「属」に決まっている。⚠ 教科書は「操作1〜5」なので画面の札には出さない。
 * ★ 出すのは答え合わせだけ）。
 *
 * ★★ 属の中に2つ入るものがある（2026-08-28・§20-6 の (b)）——
 *   **第1属 ＝ Ag⁺ と Pb²⁺**（★ 熱湯で PbCl₂ だけ溶ける）／
 *   **第3属 ＝ Fe³⁺ と Al³⁺**（★ 過剰の水酸化ナトリウム水溶液で Al(OH)₃ だけ溶ける）／
 *   ★★ **第5属 ＝ Ca²⁺ と Ba²⁺**（2026-08-30・**希酢酸に溶かしてクロム酸カリウム**で
 *     BaCrO₄ だけが沈む）。⚠ **硫酸ではない** —— 教科書 p.90 式(13)(14)・p.96 は
 *     CaSO₄ も BaSO₄ も「白・強酸に不溶」と書いており、**硫酸では属の中が割れない**。
 * ⚠ これが**手順のバリエーションの唯一の源**である（★ 属を欠けさせても手順は変わらない）。
 */
var TREE_GROUP = { Ag: 1, Pb: 1, Cu: 2, Fe: 3, Al: 3, Zn: 4, Ca: 5, Ba: 5, Na: 6 };

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
    // ★★ 第1属のもう1つ（2026-08-28）。⚠ Ag⁺ と同じ段で沈むので、**属の中で割る**必要が出る
    Pb: {
        hcl: { ppt: true, f: 'PbCl₂', c: '白色', why: '鉛(II)イオンが塩化物イオンと結びついて PbCl₂ になり、冷たい水には溶けないので沈む', ref: '教科書 p.88 表1' },
        h2s: {
            byPh: {
                acid: { ppt: true, f: 'PbS', c: '黒色', why: 'PbS は酸性でも沈殿する', ref: '教科書 p.88 表2・p.96' },
                other: { ppt: true, f: 'PbS', c: '黒色', why: 'PbS は液性によらず沈殿する', ref: '教科書 p.96' }
            }
        },
        boil: { ppt: false, why: '煮沸しても鉛(II)イオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えても鉛(II)イオンは変わらない' },
        // ⚠ 過剰のアンモニア水に溶けるのは Zn(OH)₂・Cu(OH)₂・Ag₂O の3つだけ ＝ 鉛は沈殿のまま残る
        nh3: { ppt: true, f: 'Pb(OH)₂', c: '白色', why: '白色の Pb(OH)₂ ができる。過剰のアンモニア水に溶けるのは亜鉛・銅・銀の3つだけなので、鉛は沈殿のまま残る', ref: '教科書 p.59 図32・p.90' },
        co3: { ppt: true, f: 'Pb(OH)₂', c: '白色', src: 'この教材', why: '炭酸アンモニウムの液は塩基性なので、まだ残っていた鉛(II)イオンはここで水酸化物として沈む' }
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
    // ★★ 第3属のもう1つ（2026-08-28）。⚠ Fe³⁺ と同じ段で沈むので、**属の中で割る**必要が出る
    Al: {
        hcl: { ppt: false, why: '塩化アルミニウムは水に溶けるので沈殿しない' },
        // ⚠ 教科書の硫化物の表に アルミニウム は挙がっていない ＝ どの液性でも硫化物の沈殿をつくらない
        h2s: { ppt: false, why: 'アルミニウムは硫化物の沈殿をつくらない', ref: '教科書 p.96' },
        boil: { ppt: false, why: '煮沸してもアルミニウムイオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えてもアルミニウムイオンは変わらない' },
        nh3: { ppt: true, f: 'Al(OH)₃', c: '白色', why: 'Al(OH)₃ は OH⁻ が薄くてもよく沈むので、この段で白色の沈殿になる。過剰のアンモニア水にも溶けない', ref: '教科書 p.90 式(5)(10)・p.96' },
        co3: { ppt: true, f: 'Al(OH)₃', c: '白色', src: 'この教材', why: '炭酸アンモニウムの液は塩基性なので、まだ残っていたアルミニウムイオンはここで水酸化物として沈む' }
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
    // ★★ 第5属のもう1つ（2026-08-30）。⚠ Ca²⁺ と同じ段で沈むので、**属の中で割る**必要が出る。
    //   ★ 主流の6札に対する答えは Ca²⁺ と1つ残らず同じ ＝ **主流だけでは絶対に分かれない**。
    //   ⚠⚠ これが「割らなければならない理由」を、いちばん強い形で作る。
    Ba: {
        hcl: { ppt: false, why: '塩化バリウムは水に溶けるので沈殿しない', ref: '教科書 p.88（希塩酸で沈殿するのは銀イオンと鉛(II)イオン）' },
        h2s: { ppt: false, why: 'バリウムは硫化物の沈殿をつくらない', ref: '教科書 p.96' },
        boil: { ppt: false, why: '煮沸してもバリウムイオンは変わらない' },
        hno3: { ppt: false, why: '希硝酸を加えてもバリウムイオンは変わらない' },
        nh3: { ppt: false, why: 'NH₄⁺ を共存させて OH⁻ を薄く保っているので、バリウムの水酸化物は沈まない', ref: '教科書 p.90' },
        co3: { ppt: true, f: 'BaCO₃', c: '白色', why: 'バリウムイオンが炭酸イオンと結びついて BaCO₃ になり、水に溶けないので沈む', ref: '教科書 p.90 式(12)・表3・p.96' }
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
// ★★★ 沈殿側の札（2026-08-28）—— ⚠ **主流の枝に置く札とは、置き場所が違う**
//
// 【なぜ要るのか】（§20-6・ユーザー「イオンの組み合わせ や 実験手順 のバリエーションを
//   たくさん試せる設計にすべき」）
//   ⚠ **属を欠けさせても手順は変わらない**（欠けた段が空振りするだけ）。
//   ★★ **手順が増えるのは「属の中に2つ入ったとき」だけ** —— そのとき沈殿をもう一度割る札が要る。
//
// 【★ 表の鍵は「イオン」ではなく「沈殿の化学式」】
//   ⚠ 同じ鉛でも **PbCl₂ は熱水に溶けるが PbS は溶けない**。
//   ★ 熱水や過剰の水酸化ナトリウム水溶液が相手にするのは *化合物* であって、イオンではない。
//   ＝ 化学式で引くと、この違いが表の形からそのまま出る（★ 悉皆も化学式で回す）。
//
//   out … 'sol' ＝ 溶けて出ていく（★ **脱出する**）／'ppt' ＝ 沈殿のまま残る
//   f/c … 'sol' のときの溶けた姿と色（⚠ 'ppt' のときは、もとの沈殿の式と色を引き継ぐ）
//   book… ★ **教科書／参考書の別**（⚠ 画面には出さない。§4-1 の線を後から検算するため）
// ---------------------------------------------------------------
//
// ★★ 札そのものの出典も持つ（`book`）—— ⚠ **中身の1組ごとの出典（下の表の book）とは別**。
//   ★ 「この操作を学習者に要求してよいか」は札の側の問いで、
//     「その沈殿がどうなるか」は表の側の問い。⚠ 2つを1つの欄に混ぜない。
var TREE_SUBOPS = {
    hot: {
        id: 'hot', short: '熱湯', reuse: true,
        say: '沈殿に熱湯を注ぐ',
        mean: '熱水に溶けるものだけを溶かし出す',
        book: '教科書', ref: '教科書 p.88（AgCl は熱水に溶けないが、PbCl₂ は溶ける）・p.88 表1・p.96'
    },
    naoh: {
        id: 'naoh', short: '過剰の水酸化ナトリウム水溶液', reuse: true,
        say: '沈殿に水酸化ナトリウム水溶液を過剰に加える',
        mean: '両性の水酸化物だけを溶かし出す',
        book: '教科書', ref: '教科書 p.90 式(6)(7)・p.96'
    },
    // ★★★ 第5属を割る札（2026-08-30・ユーザー承認）。
    //   ⚠⚠ **1枚の札である。**「希酢酸に溶かす」と「クロム酸カリウムを加える」を2枚に割らない
    //   —— ★ ユーザーが承認したのはこの形（＝ 2枚に割ると、教科書に無い「希酢酸に溶かす」だけの
    //   操作が単独で手札に並び、それが何のための手かを説明できなくなる）。
    //   ⚠ **札そのものは参考書由来**（化学新研究 p.479 注❼）。★ 教科書は K₂CrO₄ を
    //     「溶けている Pb²⁺ の確認」としてしか使っていない（p.96 の系統分離の図）ので、
    //     **沈殿を酸に溶かしてから使う**という前段が教科書には無い（§4-1 の線を1段広げた）。
    cro4: {
        id: 'cro4', short: '希酢酸とクロム酸カリウム', reuse: true,
        say: '沈殿を希酢酸に溶かし、クロム酸カリウム水溶液を加える',
        mean: '酸に溶かしたうえで、クロム酸イオンと沈殿をつくるものだけを落とす',
        book: '参考書', ref: '化学新研究 p.479 注❼（希酢酸に溶かし、K₂CrO₄ 水溶液を加えて黄色沈殿 BaCrO₄ が得られれば Ba²⁺ の確認。残った溶液を濃縮後、炎色反応で Ca²⁺〈橙赤〉を検出する）'
    }
};

// ⚠ 出典の言い回しを1か所で持つ（★ 同じ根拠を何度も書き写さない）
var TREE_REF_HOT = '教科書 p.88・p.88 表1・p.96（熱水に溶けるものとして挙がっているのは PbCl₂ だけ）';
var TREE_REF_NAOH_ONLY = '化学新研究 p.477 詳説❾（過剰の NaOH 水溶液に溶けるのは両性元素の水酸化物のみ）';
// ★★ 希酢酸とクロム酸カリウムの札が引く事実は3つ。⚠ **どれも別の本の別の行**なので、分けて持つ
//   ① 誰がクロム酸イオンと沈殿をつくるか（★ 教科書が名前を挙げている）
var TREE_REF_CRO4_WHO = '教科書 p.78（CrO₄²⁻ は Ag⁺・Pb²⁺・Ba²⁺ などと反応して Ag₂CrO₄〈暗赤色〉・PbCrO₄〈黄色〉・BaCrO₄〈黄色〉の沈殿を生じる）・p.96 系統分離の図（Pb²⁺ に K₂CrO₄ 水溶液 → PbCrO₄〈黄〉）';
//   ② 硫化物のうち、酸性でも沈殿したままのもの／酸性にすると溶けるもの（★ 教科書）
var TREE_REF_ACID_SULFIDE = '教科書 p.96（酸性でも沈殿するのは CuS・PbS・Ag₂S／ZnS・FeS・MnS は中性・塩基性で沈殿）・p.91 実験8❷（酸性にしたとき沈殿が溶けるものを確かめる）';
//   ③ 酸性でも沈殿したまま残るものの全体（★ 参考書の「これだけ」の言い方）
var TREE_REF_ACID_ONLY = '化学新研究 p.477（強酸性で沈殿するのは 塩化物 Ag⁺・Hg₂²⁺／硫酸塩 Ca²⁺・Sr²⁺・Ba²⁺・Pb²⁺／第1・2属の硫化物 だけ）';
//   ④ 第5属そのもの（★ この札の出どころ）
var TREE_REF_CRO4_G5 = '化学新研究 p.479 注❼（希酢酸に溶かし K₂CrO₄ 水溶液で BaCrO₄〈黄〉が得られれば Ba²⁺ の確認。残った溶液は濃縮して炎色反応で Ca²⁺〈橙赤〉を検出する）';

var TREE_SUB_RULES = {
    // --- 第1属の中を割る（★ 教科書 p.88 が名指しで書いている1組） ---
    'AgCl': {
        hot: { out: 'ppt', why: 'AgCl は熱水に溶けないので、沈殿のまま残る', ref: '教科書 p.88', book: '教科書' },
        naoh: { out: 'ppt', why: 'AgCl は両性の水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'ppt', why: 'AgCl は酸性の水溶液でも沈殿したままなので、希酢酸には溶けない', ref: TREE_REF_ACID_ONLY, book: '参考書' }
    },
    'PbCl₂': {
        hot: { out: 'sol', f: 'PbCl₂', c: '無色', why: 'PbCl₂ は熱水に溶けるので、溶けて出ていく', ref: '教科書 p.88 表1', book: '教科書' },
        naoh: { out: 'ppt', why: 'PbCl₂ は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        // ⚠ PbCl₂ は冷たい水にも幾分溶けるので、溶けている Pb²⁺ がクロム酸イオンをつかまえる。
        //   ★ どちらにしても鉛は沈殿の側に残る（＝ この札では第1属は割れない）
        cro4: { out: 'ppt', f: 'PbCrO₄', c: '黄色', why: 'PbCl₂ は水に幾分溶けるので、溶けている鉛(II)イオンがクロム酸イオンと結びついて、黄色の PbCrO₄ になる。鉛は沈殿の側に残る', ref: TREE_REF_CRO4_WHO + '／化学新研究 p.479 注❹（PbCl₂ は第1属では不完全にしか沈殿しない）', book: '教科書' }
    },
    // --- 第3属の中を割る（★ 両性水酸化物。教科書 p.90 式(6)） ---
    'Al(OH)₃': {
        hot: { out: 'ppt', why: 'Al(OH)₃ は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'sol', f: '[Al(OH)₄]⁻', c: '無色', why: 'Al(OH)₃ は両性の水酸化物なので、過剰の水酸化ナトリウム水溶液に [Al(OH)₄]⁻ となって溶ける', ref: '教科書 p.90 式(6)・p.96', book: '教科書' },
        cro4: { out: 'sol', f: 'Al³⁺', c: '無色', why: 'Al(OH)₃ は両性の水酸化物なので酸にも溶ける。アルミニウムイオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: '教科書 p.56 式(26)（Al(OH)₃ は酸や強塩基の水溶液のいずれにも溶ける）／' + TREE_REF_CRO4_WHO, book: '教科書' }
    },
    'FeO(OH)': {
        hot: { out: 'ppt', why: 'FeO(OH) は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'FeO(OH) は過剰の水酸化ナトリウム水溶液にも過剰のアンモニア水にも溶けない', ref: '教科書 p.90・p.96', book: '教科書' },
        cro4: { out: 'sol', f: 'Fe³⁺', c: '黄褐色', why: 'この沈殿は酸に溶ける。鉄(III)イオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: '教科書 p.97 章末問題（この沈殿を希硫酸に溶かしてヘキサシアニド鉄(II)酸カリウム水溶液を加える）／' + TREE_REF_CRO4_WHO, book: '教科書' }
    },
    'Fe(OH)₂': {
        hot: { out: 'ppt', why: 'Fe(OH)₂ は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'Fe(OH)₂ は過剰の水酸化ナトリウム水溶液にも過剰のアンモニア水にも溶けない', ref: '教科書 p.96', book: '教科書' },
        cro4: { out: 'sol', f: 'Fe²⁺', c: '淡緑色', why: '水酸化物なので酸に溶ける。鉄(II)イオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: TREE_REF_ACID_ONLY + '／' + TREE_REF_CRO4_WHO, book: '参考書' }
    },
    // --- ⚠ ここから下は「系統分離の順どおりに進めば置かない場所」。★ それでも悉皆で宣言する ---
    'Ag₂S': {
        hot: { out: 'ppt', why: 'Ag₂S は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'Ag₂S は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'ppt', why: 'Ag₂S は酸性でも沈殿したままなので、希酢酸には溶けない', ref: TREE_REF_ACID_SULFIDE, book: '教科書' }
    },
    'PbS': {
        hot: { out: 'ppt', why: 'PbS は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'PbS は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'ppt', why: 'PbS は酸性でも沈殿したままなので、希酢酸には溶けない', ref: TREE_REF_ACID_SULFIDE, book: '教科書' }
    },
    'Pb(OH)₂': {
        hot: { out: 'ppt', why: 'Pb(OH)₂ は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'sol', f: '[Pb(OH)₄]²⁻', c: '無色', why: 'Pb(OH)₂ は両性の水酸化物なので、過剰の水酸化ナトリウム水溶液に [Pb(OH)₄]²⁻ となって溶ける', ref: '教科書 p.59 図32 の脚注', book: '教科書' },
        cro4: { out: 'ppt', f: 'PbCrO₄', c: '黄色', why: '水酸化物なので酸には溶けるが、鉛(II)イオンはクロム酸イオンと結びついて黄色の PbCrO₄ になるので、鉛は沈殿の側に残る', ref: TREE_REF_ACID_ONLY + '／' + TREE_REF_CRO4_WHO, book: '教科書' }
    },
    'CuS': {
        hot: { out: 'ppt', why: 'CuS は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'CuS は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'ppt', why: 'CuS は酸性でも沈殿したままなので、希酢酸には溶けない', ref: TREE_REF_ACID_SULFIDE, book: '教科書' }
    },
    'FeS': {
        hot: { out: 'ppt', why: 'FeS は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'FeS は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        // ⚠ FeS は酸性では沈殿しない側の硫化物 ＝ 酸を加えると溶ける（★ 教科書の硫化物の表そのもの）
        cro4: { out: 'sol', f: 'Fe²⁺', c: '淡緑色', why: 'FeS は酸性では沈殿しないので、希酢酸に溶ける。鉄(II)イオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: TREE_REF_ACID_SULFIDE + '／' + TREE_REF_CRO4_WHO, book: '教科書' }
    },
    'ZnS': {
        hot: { out: 'ppt', why: 'ZnS は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        // ⚠ 亜鉛は両性だが、ここに在るのは **硫化物**。★ 溶けるのは「両性元素の水酸化物」だけ
        naoh: { out: 'ppt', why: 'ZnS は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'sol', f: 'Zn²⁺', c: '無色', why: 'ZnS は酸性では沈殿しないので、希酢酸に溶ける。亜鉛イオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: TREE_REF_ACID_SULFIDE + '／' + TREE_REF_CRO4_WHO, book: '教科書' }
    },
    // --- ★★★ 第5属の中を割る（2026-08-30）。⚠ **この教材で唯一、参考書だけを根拠にした分け方** ---
    'CaCO₃': {
        hot: { out: 'ppt', why: 'CaCO₃ は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'CaCO₃ は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'sol', f: 'Ca²⁺', c: '無色', why: '炭酸塩なので希酢酸に溶ける。カルシウムイオンはクロム酸イオンと沈殿をつくらないので、溶けたまま出ていく', ref: TREE_REF_CRO4_G5 + '／教科書 p.90・p.96（炭酸塩は強酸に可溶）', book: '参考書' }
    },
    'BaCO₃': {
        hot: { out: 'ppt', why: 'BaCO₃ は熱水には溶けないので、沈殿のまま残る', ref: TREE_REF_HOT, book: '教科書' },
        naoh: { out: 'ppt', why: 'BaCO₃ は水酸化物ではないので、過剰の水酸化ナトリウム水溶液には溶けない', ref: TREE_REF_NAOH_ONLY, book: '参考書' },
        cro4: { out: 'ppt', f: 'BaCrO₄', c: '黄色', why: '炭酸塩なので希酢酸には溶けるが、バリウムイオンはクロム酸イオンと結びついて黄色の BaCrO₄ になるので、沈殿の側に残る', ref: TREE_REF_CRO4_G5 + '／' + TREE_REF_CRO4_WHO, book: '参考書' }
    }
};

/** 沈殿側の規則を引く。⚠ 表に無い組は null（＝ 宣言もれ。門番が落とす） */
function treeSubRule(formula, subOpId) {
    var row = TREE_SUB_RULES[formula];
    return (row && row[subOpId]) ? row[subOpId] : null;
}

/**
 * ★ **主流の札が生みうる沈殿の化学式を、表から全部拾う**（⚠ 手で並べない）。
 *   —— 悉皆の検査と門番が、これ × 沈殿側の札を回す。
 *   ★ 主流の表に沈殿を1つ足したら、宣言もれとして自動的に赤くなる。
 */
function treeAllFormulas() {
    var seen = {};
    Object.keys(TREE_RULES).forEach(function (i) {
        Object.keys(TREE_RULES[i]).forEach(function (o) {
            [{ ph: 'acid', h2s: false }, { ph: 'neutral', h2s: false }, { ph: 'base', h2s: false },
            { ph: 'acid', h2s: true }, { ph: 'neutral', h2s: true }, { ph: 'base', h2s: true }]
                .forEach(function (env) {
                    var r = treeRule(i, o, env);
                    if (r && r.ppt && r.f) seen[r.f] = 1;
                });
        });
    });
    return Object.keys(seen).sort();
}

// ---------------------------------------------------------------
// 走らせる —— ★ **これが「アプリが実際に走らせた結果」**（§16-1 の答え合わせの片側）
//   ⚠ 途中では何も返さない。返すのは並べ終えたあとの全体だけ。
// ---------------------------------------------------------------

/**
 * @param ions  容器の中身（★ 与えられている。推理は無い）
 * @param seq   枝に置かれた操作の列。⚠ **空の枝は飛ばす**（null が混ざってよい）
 * @param sub   ★★ **沈殿側の札**（2026-08-28）。`{ 枝の番号: 沈殿側の札 }`。
 *              ⚠ 沈殿ができない枝（煮沸・希硝酸・空の枝）に置いても効かない ＝ 黙って無視する
 *              （★ 置き場そのものが画面に現れないので、模型の側で例外にする必要は無い）。
 * @returns { stages, rest, feAsFeS }
 *   stages[i] = { slot, op, splits, ppt:[{ion, from, f, c, why}], changes, turb, left:[ion],
 *                 sub, escaped:[…], stay:[…] }
 *   rest      = 最後まで溶けたまま残ったイオン（＝ 最後のろ液の葉）
 *
 * ★★ `sub` を置いた段では、沈殿が **escaped（溶けて出ていったもの）** と
 *   **stay（沈殿のまま残ったもの）** の2つに割れる。⚠ `ppt` は割る前の姿のまま残す
 *   （答え合わせが「その段で何が沈んだか」を先に言うため）。
 *
 * ⚠ `changes` は **沈まなかったが化学種が変わったもの**（Fe³⁺ ⇄ Fe²⁺）。
 *   ★ これを持たないと、答え合わせが「その手で何が起きたか」を言えない
 *     —— 溶けている側の説明を *操作のあとの状態* から引くと、
 *     「希硝酸を加えた」手の説明が「鉄はすでに Fe³⁺ なので変わらない」になってしまう（実機で踏んだ）。
 */
function treeRun(ions, seq, sub) {
    sub = sub || {};
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
        var stage = {
            slot: slot, op: opId, splits: op.splits, ppt: ppt,
            changes: changes, stayWhy: stayWhy, turb: turb,
            ph: phBefore, phAfter: ph,
            before: before, left: present.slice(),
            sub: null, escaped: [], stay: []
        };
        // ★★ 沈殿側の札 —— ⚠ **沈殿ができる枝にしか効かない**
        //   （★ 置き場は木の形から出るので、画面には最初から現れない）
        if (op.splits && sub[slot]) {
            var sid = sub[slot];
            stage.sub = sid;
            ppt.forEach(function (e) {
                var sr = treeSubRule(e.f, sid);
                // ⚠ 宣言もれ（表に無い組）は **沈殿のまま残す**。★ 門番が別途落とす
                if (!sr) { stage.stay.push(e); return; }
                var made = {
                    ion: e.ion, from: e.from,
                    f: sr.f || e.f, c: sr.c || e.c,
                    why: sr.why, src: sr.src
                };
                if (sr.out === 'sol') stage.escaped.push(made); else stage.stay.push(made);
            });
        }
        stages.push(stage);
    });

    return { stages: stages, rest: present.slice(), feAsFeS: feAsFeS };
}

/** 節の id。★ 枝 slot の沈殿側は 'L<slot>'、いちばん下のろ液は 'F' */
function treeLeafId(slot) { return 'L' + slot; }
/**
 * ★★ 沈殿をさらに割った先の id。
 *   'L<slot>s' … **溶けて出ていったもの**（脱出した側・溶液）
 *   'L<slot>p' … **沈殿のまま残ったもの**（主流を継ぐ側・沈殿）
 * ⚠⚠ 割ったとき、'L<slot>' はもう終端ではない ＝ **置き場でなくなる**（§20-4）。
 */
function treeSubLeafId(slot, side) { return 'L' + slot + side; }
var TREE_FINAL_LEAF = 'F';

/**
 * ★★ **終端の一覧を、木の形から出す**（§20-4・⚠ 「沈殿だから置ける」と決め打ちしない）。
 *   —— 沈殿側の札を置いた節は *子を持つ* ので終端でなくなり、割った先の2つが終端になる。
 */
function treeLeafIds(run) {
    var out = [];
    run.stages.forEach(function (s) {
        if (!s.op || !s.splits) return;
        if (s.sub) {
            out.push(treeSubLeafId(s.slot, 's'));
            out.push(treeSubLeafId(s.slot, 'p'));
        } else {
            out.push(treeLeafId(s.slot));
        }
    });
    out.push(TREE_FINAL_LEAF);
    return out;
}

/** 実際に走らせた結果を「葉 → 元素の列」にたたむ（★ 純度を数える単位は元素） */
function treeActualLeaves(run) {
    var out = {};
    var el = function (list) { return list.map(function (e) { return treeElement(e.ion); }); };
    run.stages.forEach(function (s) {
        if (!s.op || !s.splits) return;
        if (s.sub) {
            out[treeSubLeafId(s.slot, 's')] = el(s.escaped);
            out[treeSubLeafId(s.slot, 'p')] = el(s.stay);
        } else {
            out[treeLeafId(s.slot)] = el(s.ppt);
        }
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
 * @param sub     ★★ 沈殿側の札 `{ 枝の番号: 札 }`（2026-08-28）。⚠ 無ければ省略してよい
 * @returns 採点
 *   impure       … ⚠ 実際に2種類以上のイオンが来た葉（＝ 単離できていない）
 *   emptyPlanned … ⚠ 本人がイオンを置いたのに、実際には何も来なかった葉
 *   dirty        … ★ **単離できていない葉の数** ＝ impure + emptyPlanned（⚠ これが数えるもの）
 *   misplaced    … 机上と実際で行先が違ったイオン
 *   unplaced     … 机上でどこにも置かなかったイオン
 *   isolated     … 実際に全部が別々の葉に1つずつ入ったか
 *   matched      … 机上と実際が完全に一致したか
 */
function treeGrade(problem, seq, plan, sub) {
    var run = treeRun(problem.ions, seq, sub);
    var actual = treeActualLeaves(run);

    // 葉の一覧（★ 実在する葉だけ。⚠ 操作が置かれていない枝には葉が無い）
    //   ★★ 終端は **木の形**から出す（§20-4）——
    //   ⚠ 沈殿側の札を置いた節は子を持つので、そこはもう置き場ではない
    var leaves = treeLeafIds(run);

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
        // ★ 実際に置いた手の数（⚠ 空けた枝は数えない）。
        //   ⚠⚠ 余計な手があっても不正解にしない —— **どれが余計かは属の欠け方で変わる**。
        //   ★ 手数を見せれば学習者が自分で気づける、というのがこの数の役目
        //   ★★ 沈殿側の札も1手として数える（⚠ 効かない枝に置いた札は数えない ＝ 実際に割れた段だけ）
        moves: seq.filter(function (o) { return !!o; }).length +
            run.stages.filter(function (s) { return !!s.sub; }).length,
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
    // ⚠ 星印は持たない —— ★ 星は **難易度**（TREE_LEVELS）のもので、やり方のものではない
    read: { id: 'read', name: 'イオンの行先を答える', preset: true },
    build: { id: 'build', name: '実験手順から考える', preset: false }
};

// ---------------------------------------------------------------
// ★★★ 出題は「一覧」ではなく「毎回つくる」（2026-08-28・§20-6 の申し送り）
//   —— 型B（`sepPools` → `sepMakeProblem`）とまったく同じ道を通す。
//
// ⚠⚠ **難易度を手で付けない**（§2-4）。★ **門番が数えた値だけ**から出す（`treeDifficulty`）。
//   ★ 型A の難しさの正体は **属の中に何組入るか** ——
//     属を欠けさせても手順は変わらないが、属の中に2つ入ると **沈殿をもう一度割る段が増える**。
// ---------------------------------------------------------------

// ★ 抽選の母集団になるイオン（⚠ **属をまたいで9つ**。第1属・第3属・第5属が2つずつ持つ）
var TREE_UNIVERSE = ['Ag', 'Pb', 'Cu', 'Fe3', 'Al', 'Zn', 'Ca', 'Ba', 'Na'];

// ★ 配る札（⚠ **どの出題でも同じだけ配る**）。
//   ⚠⚠ 配る札を中身に合わせて減らすと、それ自体が解き筋のヒントになる
//   （「熱湯が配られている ＝ 第1属が2つある」と読めてしまう）。
var TREE_MAIN_DEAL = ['hcl', 'h2s', 'boil', 'hno3', 'nh3', 'co3'];
var TREE_SUB_DEAL = ['hot', 'naoh', 'cro4'];

// ⚠ 中身の数の範囲。★ 3未満は問題にならない。
//   ⚠ 上限は **9つ全部ではなく 8**（2026-08-30）——★ 第5属を足して母集団のイオンは9つになったが、
//     9つ全部入りは流れ図が3段の枝分かれ込みで縦に伸びすぎる（画面の検査の上限に当たる）。
//     ★ 属の中の3組は 6〜8種でぜんぶ作れるので、難易度のつまみは失われていない。
var TREE_ION_MIN = 3, TREE_ION_MAX = 8;

// ★ 難易度の段。⚠ **切り方はここ1か所だけに持つ**（型B の SEP_LEVELS と同じ作法）
var TREE_LEVELS = [
    { id: 'easy', name: 'やさしい', mark: '★☆☆', min: 0, max: 11 },
    { id: 'normal', name: 'ふつう', mark: '★★☆', min: 12, max: 15 },
    { id: 'hard', name: 'むずかしい', mark: '★★★', min: 16, max: 999 }
];

/** 模範の手順（★ 配られた札を、教科書の順に並べたもの） */
function treeIdealSeq(problem) {
    return TREE_STANDARD_ORDER.filter(function (o) { return problem.ops.indexOf(o) >= 0; });
}

/**
 * ★★ 模範の **沈殿側**の置き方（⚠ 決め打ちしない。★ 悉皆で試して「割れる札」を選ぶ）。
 *   —— 2種類以上が来た沈殿について、配った沈殿側の札を順に試し、
 *     **片方だけが溶け出す**札があればそれを置く。
 *   ⚠ どの札でも割れない沈殿が残れば、その出題は門番を通らない（＝ 出さない）。
 */
function treeIdealSub(problem, seq) {
    seq = seq || treeIdealSeq(problem);
    var run = treeRun(problem.ions, seq);
    var deal = problem.subOps || TREE_SUB_DEAL;
    var sub = {};
    run.stages.forEach(function (s) {
        if (!s.op || !s.splits || s.ppt.length < 2) return;
        for (var i = 0; i < deal.length; i++) {
            var esc = 0, miss = 0;
            s.ppt.forEach(function (e) {
                var sr = treeSubRule(e.f, deal[i]);
                if (!sr) { miss++; return; }
                if (sr.out === 'sol') esc++;
            });
            if (!miss && esc >= 1 && esc < s.ppt.length) { sub[s.slot] = deal[i]; break; }
        }
    });
    return sub;
}

/**
 * ★★★ **この容器で実際に要る手順**（2026-08-28・ユーザー「手順が3問すべてで同じになっている」）。
 *
 * ⚠⚠ **これは新しい出題ではない。**★ `treeAuditProblem` が理想の最短手数を数えるのに
 *   もともと使っていた刈り込みを、**数だけでなく手順そのものとして返す**ようにしただけ。
 *
 * 【なぜ要るのか】
 *   ⚠ 模範の手順（`treeIdealSeq`）は **配った札を教科書の順に並べたもの**で、
 *     配る札はどの出題でも同じ（`TREE_MAIN_DEAL`）。
 *     ＝ **どの容器でも `hcl>h2s>boil>hno3>nh3>h2s>co3` の7手で、1通りしか出ない**（実測）。
 *   ★ 刈り込んだあとは **容器ごとに変わる** —— 属が欠けていれば、その段は要らない。
 *
 * ⚠ 返す `seq` には **空き（null）が混ざる**。★ 葉の番号を保つため、ここでは詰めない
 *   （詰めるのは `treeNeededPlan`）。
 */
function treeTrimPlan(p, ideal, idealSub) {
    ideal = ideal || treeIdealSeq(p);
    var trimmed = ideal.slice();
    var trimmedSub = idealSub || treeIdealSub(p, ideal);
    var stillOk = function (seq, sub) {
        return treeGrade(p, seq, treePlanFromRun(p, seq, sub), sub).isolated;
    };
    ideal.forEach(function (o, i) {
        var probe = trimmed.slice();
        probe[i] = null;
        if (stillOk(probe, trimmedSub)) trimmed = probe;
    });
    Object.keys(trimmedSub).forEach(function (k) {
        var probe = {};
        Object.keys(trimmedSub).forEach(function (k2) { if (k2 !== k) probe[k2] = trimmedSub[k2]; });
        if (stillOk(trimmed, probe)) trimmedSub = probe;
    });
    return { seq: trimmed, sub: trimmedSub };
}

/**
 * ★★ 刈り込んだ手順を **詰めて**返す（＝ 画面にそのまま置ける形）。
 *   ⚠ 詰めると枝の番号が変わるので、★ **沈殿側の札の番号も付け替える**
 *     （付け替えないと、札が別の枝に付いて木の形が変わる）。
 * ⚠ 空いた枝を残さないのは「イオンの行先を答える」用だから ——
 *   ★ その段では枝は押せないので、空の枝は読む邪魔にしかならない。
 *   （「実験手順から考える」は今までどおり `treeSlotCount` ぶんの空き枝を出す）
 */
function treeNeededPlan(p) {
    var t = treeTrimPlan(p);
    var seq = [], map = {};
    t.seq.forEach(function (o, i) {
        if (!o) return;
        map[i] = seq.length;
        seq.push(o);
    });
    var sub = {};
    Object.keys(t.sub).forEach(function (k) {
        // ⚠ 落とした枝に付いていた札は捨てる（★ 置き場そのものが無くなっている）
        if (map[k] != null) sub[map[k]] = t.sub[k];
    });
    return { seq: seq, sub: sub };
}

/** ★ 属の中に2つ以上入っている属の数（⚠ **これが手順の段数を決める**） */
function treeCrowdedGroups(ions) {
    var n = {};
    ions.forEach(function (i) {
        var g = TREE_GROUP[treeElement(i)];
        n[g] = (n[g] || 0) + 1;
    });
    return Object.keys(n).filter(function (g) { return n[g] >= 2; }).length;
}

/**
 * 枝の数。⚠ **配った札の枚数ではない** ——
 * ★ 硫化水素は1枚の札を2つの枝に置くので、札 6 枚に対して枝は 7 本になる。
 */
function treeSlotCount(problem) { return treeIdealSeq(problem).length; }

/** 空の机上（＝ 何も置いていない） */
function treeEmptyPlan() { return {}; }

/** 実際に走らせた結果から、机上を起こす（★ やさしい段の答え合わせ・門番が使う） */
function treePlanFromRun(problem, seq, sub) {
    var run = treeRun(problem.ions, seq, sub);
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
    // ★★ 沈殿側は **化学式 × 沈殿側の札** を悉皆で見る（⚠ イオンではなく化合物が相手）。
    //   ⚠ 沈殿側の札はどの沈殿にも置けるので、**生じうる沈殿ぜんぶ**について宣言が要る
    //     （★ 置ける場所を「第1属の沈殿だけ」に狭めると、それが解き筋のヒントになる）。
    (p.subOps || []).forEach(function (so) {
        treeAllFormulas().forEach(function (f) {
            if (!treeSubRule(f, so)) undeclared.push(f + '×' + so);
        });
    });

    var ideal = treeIdealSeq(p);
    var idealSub = treeIdealSub(p, ideal);
    var idealGrade = treeGrade(p, ideal, treePlanFromRun(p, ideal, idealSub), idealSub);

    // ★ 理想の最短手数 —— 模範の手順から、抜いても単離できる手を落としていく。
    //   ⚠ **正解は1つではない**（属が欠けていれば飛ばせる段がある・干渉しない段は入れ替わる）。
    //   ★ だからここで出すのは「何手で足りるか」という数だけで、**手順そのものは出さない**。
    //   ⚠⚠ 画面はこの数だけを見せる（§ 答え合わせで模範手順を示さない）。
    //   ★★ 沈殿側の札も同じやり方で落とす（⚠ 主流を先に、沈殿側をあとに）
    var trim = treeTrimPlan(p, ideal, idealSub);
    var shortest = trim.seq.filter(function (o) { return !!o; }).length +
        Object.keys(trim.sub).length;

    // ⚠ 芯が効くか ＝ 希硝酸を抜いた答案が、模範と違う結果になるか
    // ★ **枝は空けたまま抜く**（詰めない）。⚠ 詰めると葉の番号がずれて、
    //   「机上と実際の食い違い」ではなく「番号のずれ」を数えてしまう
    var idealPlan = treePlanFromRun(p, ideal, idealSub);
    var noHno3 = ideal.map(function (o) { return o === 'hno3' ? null : o; });
    var trapGrade = treeGrade(p, noHno3, idealPlan, idealSub);
    var feTrap = trapGrade.dirty > 0 || trapGrade.misplaced.length > 0;

    // ★★ 液性が状態として効いているか ＝ 希塩酸を抜くと硫化水素の結果が変わるか
    //   ⚠ 札の中に液性を閉じ込めていたら、ここは何も変わらない（＝ この検査が落ちる）
    var noHcl = ideal.map(function (o) { return o === 'hcl' ? null : o; });
    var hclGrade = treeGrade(p, noHcl, idealPlan, idealSub);
    var idealLeaves = treeActualLeaves(treeRun(p.ions, ideal, idealSub));
    var noHclLeaves = treeActualLeaves(treeRun(p.ions, noHcl, idealSub));
    var hclTrap = JSON.stringify(idealLeaves) !== JSON.stringify(noHclLeaves);

    // ★★★ 属の中を割らずに止めたら、どうなるか（2026-08-28）
    //   ⚠⚠ **これが「属の中の分離をしなければならない理由」そのもの** ——
    //   割らずに止めると、その沈殿が終端になり、2種類入っているので単離できていない（§20-4）。
    var pairs = treeCrowdedGroups(p.ions);
    var stopGrade = treeGrade(p, ideal, idealPlan, {});
    var splitTrap = pairs === 0 ? false : (stopGrade.dirty > 0);

    return {
        id: p.id,
        undeclared: undeclared,
        ideal: ideal,
        idealSub: idealSub,
        idealDirty: idealGrade.dirty,
        shortest: shortest,
        solvable: idealGrade.isolated,
        // ★ 属の中に2つ以上入っている属の数（＝ 沈殿側で割る段の数）
        pairs: pairs,
        splitTrap: splitTrap,
        splitDirty: stopGrade.dirty,
        feTrap: feTrap,
        feDirty: trapGrade.dirty,
        feMisplaced: trapGrade.misplaced.length,
        hclTrap: hclTrap,
        hclDirty: hclGrade.dirty,
        ok: undeclared.length === 0 && idealGrade.isolated && idealGrade.dirty === 0 &&
            // ⚠ 理想の最短が2手以上（★ 1手で終わる容器は問題にならない）
            shortest >= 2 &&
            // ★ 属の中に2つ入っているなら、割らずに止めたら必ず不正解になること
            (pairs === 0 || stopGrade.dirty > 0)
    };
}

/**
 * ★ 難易度。⚠ **画面に出してよいのはこれだけ**（解き筋に触れる語を1つも含まない）。
 *
 * ★ 根拠は、門番がすでに数えている値だけから組む（⚠ 手で難易度を付けない。§2-4）:
 *   ① **中身の数** … 多いほど葉が要る
 *   ② **理想の最短手数** … その容器を単離しきるのに何手要るか
 *   ③ ★★ **属の中に2つ入っている属の数** … ⚠ **1組につき、沈殿を割る段が1つ増える**
 *      （★ ここが型A の難しさの正体。★ 属を欠けさせるだけでは手順は変わらない）
 */
function treeDifficulty(p, audit) {
    var a = audit || treeAuditProblem(p);
    var score = p.ions.length + a.shortest + 3 * a.pairs;
    var lid = treeLevelOf(score);
    var idx = 0;
    TREE_LEVELS.forEach(function (l, i) { if (l.id === lid) idx = i; });
    return {
        level: lid,
        name: TREE_LEVELS[idx].name,
        mark: TREE_LEVELS[idx].mark,
        stars: idx + 1,
        score: score,
        ions: p.ions.length,
        shortest: a.shortest,
        pairs: a.pairs
    };
}

/** 難易度の段（`treeDifficulty` の score から決まる）。⚠ 切り方は TREE_LEVELS の1か所だけ */
function treeLevelOf(score) {
    for (var i = 0; i < TREE_LEVELS.length; i++) {
        if (score >= TREE_LEVELS[i].min && score <= TREE_LEVELS[i].max) return TREE_LEVELS[i].id;
    }
    return TREE_LEVELS[TREE_LEVELS.length - 1].id;
}

/** イオンの組の呼び名（★ 並べ方に依らない）。⚠ 出題の id にもする */
function treeIonKey(ions) { return ions.slice().sort().join('-'); }

/** 中身の組から出題を1件つくる（⚠ 札の配り方は中身に依らない） */
function treeBuildProblem(ions, levelId) {
    return {
        id: treeIonKey(ions),
        ions: ions.slice(),
        ops: TREE_MAIN_DEAL.slice(),
        subOps: TREE_SUB_DEAL.slice(),
        level: levelId || null
    };
}

// ---------------------------------------------------------------
// 抽選の母集団
//   ⚠ **読み込んだ時点では作らない**（型B と同じ地雷）。★ 最初に1問引くときに1度だけ作る。
// ---------------------------------------------------------------
var _treePools = null;
function treePools() {
    if (_treePools) return _treePools;
    var pools = {};
    TREE_LEVELS.forEach(function (l) { pools[l.id] = []; });
    var rest = TREE_UNIVERSE.filter(function (i) { return i !== 'Fe3'; });
    var n = rest.length;
    for (var m = 0; m < (1 << n); m++) {
        // ⚠⚠ 鉄は必ず入れる —— ★ **この教材の芯（Fe²⁺ → Fe³⁺）を持たない容器は出さない**
        var ions = ['Fe3'];
        for (var i = 0; i < n; i++) if (m & (1 << i)) ions.push(rest[i]);
        if (ions.length < TREE_ION_MIN || ions.length > TREE_ION_MAX) continue;
        var p = treeBuildProblem(ions);
        var a = treeAuditProblem(p);
        if (!a.ok) continue;                    // ⚠ 門番を通らない組は母集団に入れない
        var d = treeDifficulty(p, a);
        pools[d.level].push({ ions: ions, score: d.score, pairs: a.pairs, shortest: a.shortest });
    }
    _treePools = pools;
    return pools;
}

/**
 * 1問つくる。
 *   opts.avoid … ⚠ **直前に出した中身の鍵**。★ 等確率で引くと同じ容器が続くので、それだけ避ける
 *   opts.rand  … 乱数（★ テストが固定するための口）
 *   opts.ions  … ⚠ **テストが出題を固定するための口**（画面は使わない）
 */
function treeMakeProblem(levelId, opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    if (opts.ions) return treeBuildProblem(opts.ions, levelId);
    var pool = treePools()[levelId] || [];
    if (!pool.length) return null;
    var pick = pool;
    if (opts.avoid && pool.length > 1) {
        pick = pool.filter(function (e) { return treeIonKey(e.ions) !== opts.avoid; });
        if (!pick.length) pick = pool;
    }
    return treeBuildProblem(pick[Math.floor(rand() * pick.length)].ions, levelId);
}

/**
 * ★ 型の鍵（型B の §18-6 (3) と同じ作法）。⚠ 送信も保存もしない。持つだけ。
 * ⚠ 札の配り方か採点を変えたら版を上げること
 */
// ⚠ A1 → A2（2026-08-28）: 硫化水素の札を2枚から1枚にし、液性を容器の状態にした。
// ⚠ A2 → A3（2026-08-28）: 沈殿側の札（熱湯・過剰の水酸化ナトリウム水溶液）を足し、
//   出題を生成にした。★ 同じ中身でも問いの意味が変わったので、古い型と混ぜて数えてはいけない。
// ⚠ A3 → A4（2026-08-30）: 第5属（Ba²⁺）と、それを割る札（希酢酸とクロム酸カリウム）を足した。
//   ★ 配る札が8枚から9枚に増えたので、古い型と混ぜて数えてはいけない。
var TREE_KEY_VERSION = 'A4';
function treeTypeKey(modeId, problem) {
    return TREE_KEY_VERSION + '|' + modeId + '|' + (problem.level || '') + '|' +
        treeIonKey(problem.ions);
}

function treeRecord(modeId, problem, extra) {
    var r = {
        key: treeTypeKey(modeId, problem),
        mode: modeId,
        level: problem.level || null,
        ions: problem.ions.slice(),
        ops: problem.ops.slice(),
        subOps: (problem.subOps || []).slice()
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
}

// node からも読めるようにする。ブラウザでは何もしない
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        TREE_COLORS: TREE_COLORS, TREE_OPS: TREE_OPS, TREE_RULES: TREE_RULES,
        TREE_SUBOPS: TREE_SUBOPS, TREE_SUB_RULES: TREE_SUB_RULES,
        TREE_UNIVERSE: TREE_UNIVERSE, TREE_LEVELS: TREE_LEVELS,
        TREE_MAIN_DEAL: TREE_MAIN_DEAL, TREE_SUB_DEAL: TREE_SUB_DEAL,
        TREE_MODES: TREE_MODES, TREE_GROUP: TREE_GROUP,
        TREE_ELEMENT_JP: TREE_ELEMENT_JP, TREE_STANDARD_ORDER: TREE_STANDARD_ORDER,
        TREE_FINAL_LEAF: TREE_FINAL_LEAF, TREE_KEY_VERSION: TREE_KEY_VERSION,
        TREE_PH_JP: TREE_PH_JP, TREE_ENVS: TREE_ENVS, treeSlotCount: treeSlotCount,
        treeIon: treeIon, treeElement: treeElement, treeRule: treeRule,
        treeSubRule: treeSubRule, treeAllFormulas: treeAllFormulas,
        treeRun: treeRun, treeLeafId: treeLeafId, treeSubLeafId: treeSubLeafId,
        treeLeafIds: treeLeafIds, treeActualLeaves: treeActualLeaves,
        treeGrade: treeGrade, treeIdealSeq: treeIdealSeq, treeIdealSub: treeIdealSub,
        treeTrimPlan: treeTrimPlan, treeNeededPlan: treeNeededPlan,
        treeCrowdedGroups: treeCrowdedGroups, treeEmptyPlan: treeEmptyPlan,
        treePlanFromRun: treePlanFromRun, treeAuditProblem: treeAuditProblem,
        treeDifficulty: treeDifficulty, treeLevelOf: treeLevelOf, treeIonKey: treeIonKey,
        treeBuildProblem: treeBuildProblem, treePools: treePools,
        treeMakeProblem: treeMakeProblem,
        treeTypeKey: treeTypeKey, treeRecord: treeRecord
    };
}
