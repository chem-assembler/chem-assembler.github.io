// 色でみる無機化学 — 系統分離モード「型B: 含まれているイオンを同定せよ」の模型
//
// DESIGN_separation.md §15（型を2つに割った）・§16（遊び方）に従う。
//   型A（すべてのイオンを単離せよ／机上のツリー）は**この版では作らない**。
//   ここにあるのは型B だけ ——「容器に1種類だけ入っている。候補から1つ言い当てよ」。
//
// 【この模型がなぜ小さいか】型B は中身が **1種類だけ** なので、
//   混合物の状態遷移も仮説集合の組み合わせ爆発も要らない。
//   仮説集合 H は「まだ消えていない候補の集合」＝ 候補リストの部分集合そのもの（§15-1）。
//   ⚠ だから `H ⊆ 2^U` を持つ必要がない。**型A を作るときは話が別**（そちらは H が要る）。
//
// 【DOM 非依存】separation.js（画面）と tests.js（回帰テスト）の両方が読む。
//   ここには document も window も出てこない。
//
// 【観察は状態から導く。答えを教えない】(§2-3)
//   返すのは「Ag⁺ が居ます」ではなく「白色の沈殿ができた」。
//   ⚠ **化学式（AgCl）は観察に含めない**。含めたら、その1手で答えを配ってしまう。
//   式は `f` に持つが、これは**答え合わせの解説だけ**が読む（obsKey にも入らない）。
//
// 【教科書の外を再現しない】(§4-1)
//   宣言していない（イオン × 操作）の組は、勝手に「変化なし」にしない。
//   `sepObserve()` は null を返し、画面は「この教材では扱っていません」と言う。
//   ⚠ 「何も起きなかった」と「扱っていない」を混ぜたら、それは創作になる。
//
// 出典は東京書籍『化学』（令和5年検定済）の該当ページ。§11・§17 の実測に基づく。

'use strict';

// ---------------------------------------------------------------
// 色 —— 名前と hex。⚠ 名前が主で、hex は名前の見える化にすぎない
// （tests.js の COLOR_WORDS が「名乗りと色相が食い違っていないか」を機械で見る）
// ---------------------------------------------------------------
var SEP_COLORS = {
    '白色': '#ffffff',
    '黒色': '#2c3e50',
    '褐色': '#795548',
    '赤褐色': '#a0522d',
    '青白色': '#85c1e9',
    '深青色': '#1a3fa0',
    '淡黄色': '#f4e08a',
    '青緑色': '#1abc9c',
    '橙赤色': '#e8590c',
    '黄色': '#f1c40f',
    '赤紫色': '#b0409a',
    '無色': null   // ⚠ 無色は色コードで表せない。日本語で持つ（chemistry.js の aqueous と同じ流儀）
};

// ---------------------------------------------------------------
// 錯イオンの色 —— ★ 出典の別を持たせる（§17-10 のユーザー決定）
//   ⚠ 画面には出さない。「教科書に書いてあったか」を後から検算するためだけに持つ。
//   [Al(OH)₄]⁻ ／ [Zn(OH)₄]²⁻ ／ [Pb(OH)₄]²⁻ の「無色」は教科書に記述が無く、
//   参考書（化学新研究 p.477「NaOHaq 過剰＝すべて無色」／要点&盲点 p.200）の裏づけ。
// ---------------------------------------------------------------
var SEP_COMPLEXES = {
    '[Ag(NH₃)₂]⁺': { color: '無色', src: '教科書', ref: '東京書籍 化学 p.67 表4' },
    '[Cu(NH₃)₄]²⁺': { color: '深青色', src: '教科書', ref: '東京書籍 化学 p.67 表4' },
    '[Zn(NH₃)₄]²⁺': { color: '無色', src: '教科書', ref: '東京書籍 化学 p.67 表4' },
    '[Al(OH)₄]⁻': { color: '無色', src: '参考書', ref: '化学新研究 p.477／要点&盲点 p.200' },
    '[Zn(OH)₄]²⁻': { color: '無色', src: '参考書', ref: '化学新研究 p.477／要点&盲点 p.200' },
    '[Pb(OH)₄]²⁻': { color: '無色', src: '参考書', ref: '化学新研究 p.477／要点&盲点 p.201' }
};

// ---------------------------------------------------------------
// イオン
//   flame … 炎色反応。⚠ **色が出るのは教科書の7元素だけ**（化学基礎 p.21 表3 の但し書き
//           「すべての元素が炎色反応を示すわけではない」）。出ないものは null。
//   names … ★ 色名が資料で割れるものは複数持つ（K⁺ は「赤紫」と「紫」）。
//           画面に出すのは names[0]。残りは答え合わせの解説で「とも書かれます」と添える。
// ---------------------------------------------------------------
// ⚠ 炎色で色が出るのは7元素だけ、の出典。★ データに持つが画面には出さない
var SEP_FLAME_LIMIT_REF = '教科書 化学基礎 p.21 表3（すべての元素が炎色反応を示すわけではない）';

var SEP_IONS = {
    Ag: { id: 'Ag', name: 'Ag⁺', jp: '銀イオン', flame: null },
    Pb: { id: 'Pb', name: 'Pb²⁺', jp: '鉛(II)イオン', flame: null },
    Cu: { id: 'Cu', name: 'Cu²⁺', jp: '銅(II)イオン', flame: { names: ['青緑色'], ref: '教科書 p.88 図1' } },
    Ca: { id: 'Ca', name: 'Ca²⁺', jp: 'カルシウムイオン', flame: { names: ['橙赤色'], ref: '教科書 p.88 図1' } },
    Na: { id: 'Na', name: 'Na⁺', jp: 'ナトリウムイオン', flame: { names: ['黄色'], ref: '教科書 p.88 図1' } },
    K: { id: 'K', name: 'K⁺', jp: 'カリウムイオン', flame: { names: ['赤紫色', '紫色'], ref: '教科書 p.88 図1／薄い赤紫は参考書' } },
    Zn: { id: 'Zn', name: 'Zn²⁺', jp: '亜鉛イオン', flame: null },
    Al: { id: 'Al', name: 'Al³⁺', jp: 'アルミニウムイオン', flame: null },
    Fe3: { id: 'Fe3', name: 'Fe³⁺', jp: '鉄(III)イオン', flame: null }
};

// ---------------------------------------------------------------
// 操作の札
//   say  … 実験の言い方（何をしたか）
//   mean … その操作が何を見ているか
//   ⚠ 札は「1回の完結した実験」にしてある。試料は毎回とり分ける形なので、
//     容器の状態を持ち越さない ＝ 順番の制約が1つも無い（§2-2「順番は完全に自由」）。
//     ★ 「沈殿に熱水」「沈殿にアンモニア水」を1枚の札にしているのはこのため。
//     これは教科書 p.88 の言い方そのもの（「AgCl は熱水に溶けないが、PbCl₂ は溶ける。
//     また、AgCl はアンモニア水に溶けるが、PbCl₂ は溶けない」）。
//   ★ 炎色反応は型B では **最初から押せる**（§15-4）。分けるべきものが最初から無いから。
// ---------------------------------------------------------------
var SEP_OPS = {
    flame: {
        id: 'flame', short: '炎色反応',
        say: '白金線に試料をつけ、バーナーの外炎に入れる',
        mean: '炎の色を見る（色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7元素だけ）'
    },
    hcl: {
        id: 'hcl', short: '希塩酸',
        say: '希塩酸を加える',
        mean: '塩化物が水に溶けにくいイオンを沈殿させる'
    },
    hclHot: {
        id: 'hclHot', short: '沈殿に熱水',
        say: '希塩酸を加えたあと、できた沈殿に熱水を注ぐ',
        mean: 'PbCl₂ は熱水に溶ける。AgCl は溶けない'
    },
    hclNh3: {
        id: 'hclNh3', short: '沈殿にアンモニア水',
        say: '希塩酸を加えたあと、できた沈殿にアンモニア水を加える',
        mean: 'AgCl はアンモニア水に溶ける。PbCl₂ は溶けない'
    },
    h2s: {
        id: 'h2s', short: '硫化水素（酸性）',
        say: '酸性にして硫化水素を通す',
        mean: '酸性でも沈殿する硫化物があるかを見る'
    },
    nh3: {
        id: 'nh3', short: 'アンモニア水',
        say: 'アンモニア水を、少量から過剰まで加えていく',
        mean: '水酸化物ができるか、過剰で錯イオンになって溶けるかを見る'
    },
    naoh: {
        id: 'naoh', short: '水酸化ナトリウム',
        say: '水酸化ナトリウム水溶液を、少量から過剰まで加えていく',
        mean: '水酸化物ができるか、過剰で溶ける（両性）かを見る'
    }
};

// ---------------------------------------------------------------
// 観察の表
//
//   k    … 観察の種類。⚠ **学習者に見えるもの**だけで決まる
//          ppt        沈殿ができた
//          pptGone    沈殿ができ、加え続けると溶けた
//          pptKeep    沈殿ができ、加え続けても溶けなかった
//          dissolve   （前段でできた）沈殿が溶けた
//          keep       （前段でできた）沈殿は溶けなかった
//          nopre      前段で沈殿ができないので、この実験は行えなかった
//          none       見た目に変化はなかった
//          flame      炎に色がついた
//          flameNone  炎に色はつかなかった
//   c    … 見えた色（沈殿・濁り・炎）
//   toc  … 溶けたあとの溶液の色
//   f, to, why … ⚠ **答え合わせの解説だけ**が読む。観察の同一性（obsKey）には入れない
//
//   ⚠⚠ 同じ見え方の2つは、**同じ文章**にすること（tests.js が機械で見張っている）。
//      「亜鉛は酸性では沈殿しない」のような、見た目に差の無い言い分けをすると、
//      化学ではなくアプリの言い回しから答えが出てしまう（§12-6 で数えた漏れと同じ形）。
// ---------------------------------------------------------------
// ⚠⚠ **`ref`（本の名前とページ）は画面に出さない**（2026-08-27・ユーザー決定）。
//   ★ 世間で使われている教科書は1社ではないので、ページ番号は学習者の手元と合わない。
//   ⚠ **ただしデータからは消さない** —— §4-1 の線（教科書の外を再現しない）を
//     後から検算できる唯一の手がかりだから。★ §17-10 の `src` とまったく同じ扱い。
var SEP_TABLE = {
    Ag: {
        hcl: { k: 'ppt', c: '白色', f: 'AgCl', why: '銀イオンは塩化物イオンと結びついて AgCl になり、水に溶けないので沈む', ref: '教科書 p.88 表1' },
        hclHot: { k: 'keep', f: 'AgCl', why: 'AgCl は熱水には溶けない', ref: '教科書 p.88' },
        hclNh3: { k: 'dissolve', toc: '無色', f: 'AgCl', to: '[Ag(NH₃)₂]⁺', why: 'AgCl はアンモニア水に溶けて、無色の錯イオン [Ag(NH₃)₂]⁺ になる', ref: '教科書 p.88・p.94' },
        h2s: { k: 'ppt', c: '黒色', f: 'Ag₂S', why: 'Ag₂S は酸性でも沈殿する', ref: '教科書 p.96' },
        nh3: { k: 'pptGone', c: '褐色', toc: '無色', f: 'Ag₂O', to: '[Ag(NH₃)₂]⁺', why: 'いったん褐色の Ag₂O ができ、過剰のアンモニア水で [Ag(NH₃)₂]⁺ になって溶ける', ref: '教科書 p.90 式(10)' },
        naoh: { k: 'pptKeep', c: '褐色', f: 'Ag₂O', why: 'Ag₂O は過剰の水酸化ナトリウムには溶けない（過剰の NaOH に溶けるのは Al(OH)₃ と Zn(OH)₂ だけ）', ref: '教科書 p.90' }
    },
    Pb: {
        hcl: { k: 'ppt', c: '白色', f: 'PbCl₂', why: '鉛(II)イオンは塩化物イオンと結びついて PbCl₂ になり、冷水には溶けないので沈む', ref: '教科書 p.88 表1' },
        hclHot: { k: 'dissolve', toc: '無色', f: 'PbCl₂', why: 'PbCl₂ は熱水に溶ける', ref: '教科書 p.88' },
        hclNh3: { k: 'keep', f: 'PbCl₂', why: 'PbCl₂ はアンモニア水には溶けない', ref: '教科書 p.88' },
        h2s: { k: 'ppt', c: '黒色', f: 'PbS', why: 'PbS は酸性でも沈殿する', ref: '教科書 p.96' },
        nh3: { k: 'pptKeep', c: '白色', f: 'Pb(OH)₂', why: 'Pb(OH)₂ は過剰のアンモニア水には溶けない（過剰の NH₃ に溶けるのは Zn(OH)₂・Cu(OH)₂・Ag₂O だけ）', ref: '教科書 p.90' },
        naoh: { k: 'pptGone', c: '白色', toc: '無色', f: 'Pb(OH)₂', to: '[Pb(OH)₄]²⁻', why: 'Pb(OH)₂ は両性の水酸化物で、過剰の水酸化ナトリウムに溶ける', ref: '教科書 p.59 図32' }
    },
    Cu: {
        hcl: { k: 'none', why: '塩化銅(II) は水に溶けるので、沈殿しない' },
        hclHot: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        hclNh3: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        h2s: { k: 'ppt', c: '黒色', f: 'CuS', why: 'CuS は酸性でも沈殿する', ref: '教科書 p.88 表2・p.96' },
        nh3: { k: 'pptGone', c: '青白色', toc: '深青色', f: 'Cu(OH)₂', to: '[Cu(NH₃)₄]²⁺', why: 'いったん青白色の Cu(OH)₂ ができ、過剰のアンモニア水で深青色の [Cu(NH₃)₄]²⁺ になって溶ける', ref: '教科書 p.90 式(4)(9)・p.67 表4' },
        naoh: { k: 'pptKeep', c: '青白色', f: 'Cu(OH)₂', why: 'Cu(OH)₂ は過剰の水酸化ナトリウムには溶けない', ref: '教科書 p.90 式(4)' }
    },
    Ca: {
        hcl: { k: 'none', why: '塩化カルシウムは水に溶けるので、沈殿しない' },
        hclHot: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        hclNh3: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        h2s: { k: 'none', why: 'カルシウムは硫化物の沈殿をつくらない（硫化物として沈殿するのは Cu・Pb・Ag・Zn・Fe・Mn）', ref: '教科書 p.96' },
        nh3: { k: 'none', why: 'カルシウムの水酸化物は、この条件では沈殿として見えない' }
    },
    Na: {
        hcl: { k: 'none', why: 'ナトリウムの塩はすべて水に溶ける', ref: '教科書 p.88' },
        hclHot: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        hclNh3: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        h2s: { k: 'none', why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        nh3: { k: 'none', why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        naoh: { k: 'none', why: 'ナトリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' }
    },
    K: {
        hcl: { k: 'none', why: 'カリウムの塩はすべて水に溶ける', ref: '教科書 p.88' },
        hclHot: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        hclNh3: { k: 'nopre', why: '希塩酸では沈殿ができないので、溶かす実験そのものが行えない' },
        h2s: { k: 'none', why: 'カリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        nh3: { k: 'none', why: 'カリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' },
        naoh: { k: 'none', why: 'カリウムはいかなる試薬とも沈殿をつくらない', ref: '教科書 p.88' }
    },
    Zn: {
        hcl: { k: 'none', why: '塩化亜鉛は水に溶けるので、沈殿しない' },
        h2s: { k: 'none', why: 'ZnS は中性・塩基性でできる沈殿で、酸性では沈殿しない', ref: '教科書 p.96' },
        nh3: { k: 'pptGone', c: '白色', toc: '無色', f: 'Zn(OH)₂', to: '[Zn(NH₃)₄]²⁺', why: 'いったん白色の Zn(OH)₂ ができ、過剰のアンモニア水で無色の [Zn(NH₃)₄]²⁺ になって溶ける', ref: '教科書 p.90 式(8)・p.67' },
        naoh: { k: 'pptGone', c: '白色', toc: '無色', f: 'Zn(OH)₂', to: '[Zn(OH)₄]²⁻', why: 'Zn(OH)₂ は両性の水酸化物で、過剰の水酸化ナトリウムに溶ける', ref: '教科書 p.90 式(7)' }
    },
    Al: {
        hcl: { k: 'none', why: '塩化アルミニウムは水に溶けるので、沈殿しない' },
        h2s: { k: 'none', why: 'アルミニウムは硫化物の沈殿をつくらない', ref: '教科書 p.96' },
        nh3: { k: 'pptKeep', c: '白色', f: 'Al(OH)₃', why: 'Al(OH)₃ は過剰のアンモニア水には溶けない（過剰の NH₃ に溶けるのは Zn(OH)₂・Cu(OH)₂・Ag₂O だけ）', ref: '教科書 p.90' },
        naoh: { k: 'pptGone', c: '白色', toc: '無色', f: 'Al(OH)₃', to: '[Al(OH)₄]⁻', why: 'Al(OH)₃ は両性の水酸化物で、過剰の水酸化ナトリウムに溶ける', ref: '教科書 p.90 式(6)' }
    },
    Fe3: {
        hcl: { k: 'none', why: '塩化鉄(III) は水に溶けるので、沈殿しない' },
        // ⚠ ここは「変化なし」ではない。硫化水素が還元剤としてはたらき、
        //   酸化された硫黄が淡黄色の濁りになる（教科書 p.83 図説3 の脚注）。
        //   ★ 設計書 §11-4 の W11。教科書とセミナーの両方に載っている
        h2s: { k: 'ppt', c: '淡黄色', f: 'S', why: '硫化水素が還元剤としてはたらいて Fe³⁺ が Fe²⁺ になり、酸化された硫黄 S が淡黄色の濁りとして出る', ref: '教科書 p.83' },
        nh3: { k: 'pptKeep', c: '赤褐色', f: 'FeO(OH)', why: 'FeO(OH) は過剰のアンモニア水にも過剰の水酸化ナトリウムにも溶けない', ref: '教科書 p.90' },
        naoh: { k: 'pptKeep', c: '赤褐色', f: 'FeO(OH)', why: 'FeO(OH) は過剰のアンモニア水にも過剰の水酸化ナトリウムにも溶けない', ref: '教科書 p.90' }
    }
};

// ---------------------------------------------------------------
// 出題（型B）—— ★ 問題は「一覧」ではなく「毎回つくる」（2026-08-26・ユーザー決定）
//
//   ⚠⚠ **見た目は1問。**「べつの容器にする」を押すたびに、候補リストごと引き直す。
//   ★ **難易度は学習者が選ぶ。**⚠ **難易度 ＝ 候補リストの型**（§15-4・§16-6）。
//
// ⚠⚠ **出題に説明文（title・note）を持たせない**（2026-08-27・ユーザー指摘）。
//   ★ 「炎色で3つに割れるが、残り2つは沈殿を溶かさないと分かれない」のような一文は、
//     冗長である以前に**解き筋そのもの**で、先に読ませたら問題が成立しない。
//   ★ 画面に出すのは**難易度の印と候補の数だけ**（⚠ 試薬の名前を1つも含まない）。
//   —— tests.js が「出題に解き筋の語が無いこと」を機械で見張っている。
//
// ★ 難易度は手で付けない（§2-4）。**門番が数えた値だけ**から出す（`sepDifficulty()`）。
// ---------------------------------------------------------------
var SEP_LEVELS = [
    { id: 'easy', name: 'やさしい', mark: '★☆☆', min: 0, max: 7 },
    { id: 'normal', name: 'ふつう', mark: '★★☆', min: 8, max: 9 },
    { id: 'hard', name: 'むずかしい', mark: '★★★', min: 10, max: 999 }
];

// 候補の数の範囲。⚠ 3未満は問題にならず、7以上は札の数に対して重い
var SEP_CAND_MIN = 3, SEP_CAND_MAX = 6;

// ★ 型の鍵の版。⚠ **札の配り方や門番を変えたら、この版を上げること**
//   （集計を後からするなら、意味の変わった型を同じ鍵で混ぜてはいけない）
var SEP_KEY_VERSION = 'B1';

// ---------------------------------------------------------------
// 観察を導く
// ---------------------------------------------------------------

/**
 * イオン1種類だけが入った容器に操作 op を行ったときの観察。
 * ⚠ 表に無い組は **null**（＝「この教材では扱っていない」）。勝手に「変化なし」にしない。
 */
function sepObserve(ionId, opId) {
    if (opId === 'flame') {
        var ion = SEP_IONS[ionId];
        if (!ion) return null;
        if (!ion.flame) return { k: 'flameNone' };
        return { k: 'flame', c: ion.flame.names[0], alt: ion.flame.names.slice(1) };
    }
    var row = SEP_TABLE[ionId];
    if (!row || !row[opId]) return null;
    return row[opId];
}

/**
 * 観察の見分けのつく形（＝**学習者の目に見えるもの**だけ）。
 * ⚠ 化学式 f と説明 why は入れない。入れたら、その1手で答えが割れてしまう。
 */
function sepObsKey(obs) {
    if (!obs) return 'x';
    return [obs.k, obs.c || '', obs.toc || ''].join('|');
}

/** 観察の文章。⚠ 同じ obsKey なら必ず同じ文章になること（tests.js が見張る） */
function sepObsText(obs) {
    if (!obs) return 'この教材では、この操作の結果は扱っていません。';
    switch (obs.k) {
        case 'ppt': return obs.c + 'の沈殿ができた。';
        case 'pptGone': return obs.c + 'の沈殿ができたが、加え続けると溶けて' + obs.toc + 'の溶液になった。';
        case 'pptKeep': return obs.c + 'の沈殿ができ、加え続けても溶けなかった。';
        case 'dissolve': return '沈殿は溶けて、' + obs.toc + 'の溶液になった。';
        case 'keep': return '沈殿は溶けなかった。';
        case 'nopre': return '希塩酸では沈殿ができなかったので、この実験は行えなかった。';
        case 'none': return '見た目に変化はなかった。';
        case 'flame': return '炎が' + obs.c + 'になった。';
        case 'flameNone': return '炎に色はつかなかった。';
    }
    return '';
}

/** 画面に出す色（無色・色なしは null）。⚠ 色は名前が主で、hex はその見える化 */
function sepObsColor(obs) {
    if (!obs) return null;
    var name = obs.c || obs.toc || null;
    if (!name) return null;
    return { name: name, hex: SEP_COLORS[name] || null };
}

// ---------------------------------------------------------------
// 仮説（＝まだ消えていない候補）
// ---------------------------------------------------------------

/**
 * これまでの観察と矛盾しない候補を返す。
 * history … [{ op, obs }] （obs は実際に見えたもの ＝ 正解のイオンの観察）
 * ★ 型B は「1種類だけ」なので、これがそのまま仮説集合 H（§15-1）。
 */
function sepAlive(cands, history) {
    return cands.filter(function (c) {
        return history.every(function (h) {
            return sepObsKey(sepObserve(c, h.op)) === sepObsKey(h.obs);
        });
    });
}

/** 操作 op を行ったとき、いまの候補が観察でいくつの組に割れるか（§3-0 の物差し） */
function sepSplit(cands, opId) {
    var groups = {};
    cands.forEach(function (c) {
        var k = sepObsKey(sepObserve(c, opId));
        (groups[k] = groups[k] || []).push(c);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
}

// ---------------------------------------------------------------
// 出題の門番（§2-4 の型B 版）
//   ⚠ 型B の門番が見るのはこの2つ:
//     ① 配った札で、どの候補も他の候補と見分けられること（分けられない組があったら出題できない）
//     ② 1手で全部決まらないこと（下限。§2-4「1手で決まる T は出さない」）
//   ★ ⚠ 「色が被らないこと」は求めない —— 被りは潰すものではなく道具（§16-6）。
// ---------------------------------------------------------------

/** 部分集合をすべて（小さいものから）たどる */
function sepSubsets(arr) {
    var out = [];
    var n = arr.length;
    for (var m = 0; m < (1 << n); m++) {
        var s = [];
        for (var i = 0; i < n; i++) if (m & (1 << i)) s.push(arr[i]);
        out.push(s);
    }
    out.sort(function (a, b) { return a.length - b.length; });
    return out;
}

/** 操作集合 C で、候補 a と b が見分けられるか */
function sepSeparates(ops, a, b) {
    return ops.some(function (o) {
        return sepObsKey(sepObserve(a, o)) !== sepObsKey(sepObserve(b, o));
    });
}

/**
 * 出題を検査する。⚠ 決めつけずに数える —— 出せるかどうかは数えた結果で決まる。
 * 返すもの:
 *   undeclared … 表に無い（イオン × 札）の組。⚠ 1件でもあれば出題データの不備
 *   unresolved … 配った札では見分けられない候補の組
 *   shortest   … 理想の最短（どの中身でも決まる操作集合の、最小の手数）
 *   minimal    … その最小の集合すべて
 *   byIon      … 各候補を1つに決めるのに要る最小の操作集合（複数ありうる）
 *   ok         … 出題してよいか
 */
function sepAuditProblem(p) {
    var undeclared = [];
    p.cands.forEach(function (c) {
        p.ops.forEach(function (o) {
            if (!sepObserve(c, o)) undeclared.push(c + '×' + o);
        });
    });

    var unresolved = [];
    for (var i = 0; i < p.cands.length; i++) {
        for (var j = i + 1; j < p.cands.length; j++) {
            if (!sepSeparates(p.ops, p.cands[i], p.cands[j])) {
                unresolved.push(p.cands[i] + '/' + p.cands[j]);
            }
        }
    }

    // 理想の最短 ＝ すべての組を見分ける最小の操作集合（§3-5 の定義。試料に依らない）
    var subsets = sepSubsets(p.ops);
    var shortest = null, minimal = [];
    subsets.forEach(function (s) {
        if (shortest !== null && s.length > shortest) return;
        var all = true;
        for (var i = 0; i < p.cands.length && all; i++) {
            for (var j = i + 1; j < p.cands.length && all; j++) {
                if (!sepSeparates(s, p.cands[i], p.cands[j])) all = false;
            }
        }
        if (all) {
            if (shortest === null) shortest = s.length;
            if (s.length === shortest) minimal.push(s);
        }
    });

    // 候補ごとの最小集合 ＝「その1つを、他の全部と見分ける」最小の札
    var byIon = {};
    p.cands.forEach(function (x) {
        var best = null, sets = [];
        subsets.forEach(function (s) {
            if (best !== null && s.length > best) return;
            var ok = p.cands.every(function (y) {
                return y === x || sepSeparates(s, x, y);
            });
            if (ok) {
                if (best === null) best = s.length;
                if (s.length === best) sets.push(s);
            }
        });
        byIon[x] = { size: best, sets: sets };
    });

    // ⚠ いちばん楽な当たり方 ＝ どれか1つの候補を決めるのに要る最小の手数。
    //   ★ 第1段の候補リストでは 1 になる（例: b1 で炎が青緑なら、その1手で Cu²⁺ に決まる）。
    //   設計書 §2-4 の「1手で決まる T は出さない」は型A・型2（中身が部分集合）の下限で、
    //   型B（1種類・どの札が効くかは学習者が選ぶ）にそのまま掛けると候補リストが組めない。
    //   ★ **出題の門番は問題全体の理想の最短（shortest ≥ 2）で掛ける**。ここは数えて出すだけ。
    var easiest = null;
    p.cands.forEach(function (x) {
        if (easiest === null || byIon[x].size < easiest) easiest = byIon[x].size;
    });

    return {
        id: p.id,
        undeclared: undeclared,
        unresolved: unresolved,
        shortest: shortest,
        minimal: minimal,
        byIon: byIon,
        easiest: easiest,
        ok: undeclared.length === 0 && unresolved.length === 0 && shortest !== null && shortest >= 2
    };
}

/**
 * ★ 難易度。⚠ **画面に出してよいのはこれだけ**（解き筋に触れる語を1つも含まない）。
 *
 * ★ 根拠は、門番がすでに数えている値だけから組む（手で難易度を付けない。§2-4）:
 *   ① **候補の数** … 多いほど絞りきるのに手数が要る
 *   ② **理想の最短手数** … どの中身でも決まる操作集合の、最小の大きさ（§3-5 の定義）
 *   ③ ★ **単独の1手では決まらない候補の数** … ⚠ **「どれか1枚で当たる」で済まない候補が何個あるか**
 *      （＝ `byIon` の最小集合が2手以上のもの。★ 死んでいる札が混ざるほど、ここが増える）
 *
 * ⚠ ③を入れないと、候補の数が同じ b1 と b3 が同じ難易度になる（実測）。
 */
function sepDifficulty(p) {
    var a = sepAuditProblem(p);
    var hard = p.cands.filter(function (x) { return a.byIon[x].size >= 2; }).length;
    var score = p.cands.length + a.shortest + hard;
    // ★ 段の切り方は SEP_LEVELS の1か所だけに持つ（⚠ ここで二重に持たない）
    var lid = sepLevelOf(score);
    var idx = 0;
    SEP_LEVELS.forEach(function (l, i) { if (l.id === lid) idx = i; });
    return {
        level: lid,
        name: SEP_LEVELS[idx].name,
        mark: SEP_LEVELS[idx].mark,
        stars: idx + 1,
        score: score,
        cands: p.cands.length,
        shortest: a.shortest,
        hard: hard
    };
}

/** そのイオンの組に、配れるだけ札を配る。⚠ 結果を宣言していない札は配らない（§4-1） */
function sepDealFor(cands) {
    return Object.keys(SEP_OPS).filter(function (o) {
        return cands.every(function (c) { return !!sepObserve(c, o); });
    });
}

/** 難易度の段（`sepDifficulty` の score から決まる） */
function sepLevelOf(score) {
    for (var i = 0; i < SEP_LEVELS.length; i++) {
        if (score >= SEP_LEVELS[i].min && score <= SEP_LEVELS[i].max) return SEP_LEVELS[i].id;
    }
    return SEP_LEVELS[SEP_LEVELS.length - 1].id;
}

// ---------------------------------------------------------------
// 抽選の母集団
//   ⚠ **起動時には作らない**（§2-4 の地雷）。★ 最初に1問引くときに1度だけ作って持ち回る。
//   ★ 費用は実測 44ms（イオン9・札7・候補3〜6個 ＝ 420 組の門番）。
// ---------------------------------------------------------------
var _sepPools = null;
function sepPools() {
    if (_sepPools) return _sepPools;
    var ions = Object.keys(SEP_IONS);
    var pools = {};
    SEP_LEVELS.forEach(function (l) { pools[l.id] = []; });
    sepSubsets(ions).forEach(function (C) {
        if (C.length < SEP_CAND_MIN || C.length > SEP_CAND_MAX) return;
        var ops = sepDealFor(C);
        if (!ops.length) return;
        var p = { id: 'gen', cands: C, ops: ops };
        var a = sepAuditProblem(p);
        if (!a.ok) return;                       // ⚠ 門番を通らない組は母集団に入れない
        var d = sepDifficulty(p);
        pools[sepLevelOf(d.score)].push({ cands: C, ops: ops, score: d.score });
    });
    _sepPools = pools;
    return pools;
}

/**
 * ★ 型の鍵。⚠ **遊ぶたびに変わらないもの**（＝ 集計できる単位）。
 * ⚠⚠ 中身のイオン（truth）は入れない —— 同じ型の別の出題を、同じ鍵で数えたいから。
 */
function sepTypeKey(levelId, cands) {
    return SEP_KEY_VERSION + '|' + levelId + '|' + cands.slice().sort().join('-');
}

/**
 * 1問つくる。
 *   opts.avoid … ⚠ **直前に出した型の鍵**。★ 等確率で引くと解き筋が2回3回と続くので、それだけ避ける
 *   opts.rand  … 乱数（テストが固定するための口）
 *   opts.cands / opts.ops / opts.truth … ⚠ **テストが出題を固定するための口**（画面は使わない）
 */
function sepMakeProblem(levelId, opts) {
    opts = opts || {};
    var rand = opts.rand || Math.random;
    var cands, ops;
    if (opts.cands) {
        cands = opts.cands.slice();
        ops = opts.ops ? opts.ops.slice() : sepDealFor(cands);
    } else {
        var pool = sepPools()[levelId] || [];
        if (!pool.length) return null;
        var pick = pool;
        if (opts.avoid && pool.length > 1) {
            pick = pool.filter(function (e) {
                return sepTypeKey(levelId, e.cands) !== opts.avoid;
            });
            if (!pick.length) pick = pool;
        }
        var e = pick[Math.floor(rand() * pick.length)];
        cands = e.cands.slice();
        ops = e.ops.slice();
    }
    var truth = opts.truth || cands[Math.floor(rand() * cands.length)];
    return {
        id: sepTypeKey(levelId, cands),      // ★ 型の鍵 ＝ そのまま出題の id
        key: sepTypeKey(levelId, cands),
        level: levelId,
        cands: cands,
        ops: ops,
        truth: truth
    };
}

/**
 * ★ 記録の形（⚠ **持たせるだけ。送信も保存もしない**）。
 *   ★ 集計できる安定した単位は「型」であって、個々の出題ではない
 *     （毎回つくる形にしたので、出題そのものは毎回別物）。
 *   ⚠ 中身のイオン（truth）も残す —— **同じ型でも、入っていたイオンで難しさが変わる**。
 */
function sepRecord(problem, extra) {
    var r = {
        key: problem.key,
        level: problem.level,
        cands: problem.cands.slice(),
        ops: problem.ops.slice(),
        truth: problem.truth
    };
    if (extra) Object.keys(extra).forEach(function (k) { r[k] = extra[k]; });
    return r;
}

// ---------------------------------------------------------------
// 答え合わせ
//   ★ 文面の向き（§3-3）: 「あなたは間違えました」ではなく「あなたの操作でこうなりました」。
//   ⚠ 型B に「まだわからない」は無い（§16-3）。答えるタイミングを学習者が握っているので、
//     当てずっぽうを強いる構図がそもそも生まれない。
//   ⚠ 判定の2軸（§3-5-2）は型B では1本になる —— 足りなければ外れるから。
// ---------------------------------------------------------------

/**
 * 採点する。
 *   picked … 学習者が選んだ候補 ／ truth … 実際に入っていたもの
 * 返す verdict:
 *   'decided'  正解。しかも操作が答えを決めていた
 *   'lucky'    正解。⚠ ただし観察と矛盾しない候補が他にも残っていた
 *   'missed'   不正解。★ どの観察と食い違うかを名指しできる
 *   'unread'   不正解。⚠ 観察とは矛盾しないが、別のほうだった（＝ 手順が足りていない）
 */
function sepGrade(p, truth, picked, history) {
    var alive = sepAlive(p.cands, history);
    var correct = (picked === truth);
    var pickedAlive = alive.indexOf(picked) >= 0;
    var verdict;
    if (correct) verdict = (alive.length === 1) ? 'decided' : 'lucky';
    else verdict = pickedAlive ? 'unread' : 'missed';

    // ★ 選んだものが、どの観察と食い違うか（＝「あなたの操作でこうなりました」の材料）
    var conflicts = [];
    history.forEach(function (h, i) {
        var mine = sepObserve(picked, h.op);
        if (sepObsKey(mine) !== sepObsKey(h.obs)) {
            conflicts.push({ step: i + 1, op: h.op, seen: h.obs, expected: mine });
        }
    });

    // ★ 各手が、何を消したか（答え合わせでだけ出す。途中では何も言わない ＝ D1(a)）
    var steps = [], before = p.cands.slice();
    history.forEach(function (h, i) {
        var after = sepAlive(p.cands, history.slice(0, i + 1));
        steps.push({
            step: i + 1, op: h.op, obs: h.obs,
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

// node（回帰テストのデータ部分）からも読めるようにする。ブラウザでは何もしない
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        SEP_COLORS: SEP_COLORS, SEP_COMPLEXES: SEP_COMPLEXES, SEP_IONS: SEP_IONS,
        SEP_OPS: SEP_OPS, SEP_TABLE: SEP_TABLE, SEP_LEVELS: SEP_LEVELS,
        SEP_FLAME_LIMIT_REF: SEP_FLAME_LIMIT_REF, SEP_KEY_VERSION: SEP_KEY_VERSION,
        sepObserve: sepObserve, sepObsKey: sepObsKey, sepObsText: sepObsText,
        sepObsColor: sepObsColor, sepAlive: sepAlive, sepSplit: sepSplit,
        sepSeparates: sepSeparates, sepAuditProblem: sepAuditProblem,
        sepDifficulty: sepDifficulty, sepGrade: sepGrade, sepDealFor: sepDealFor,
        sepLevelOf: sepLevelOf, sepPools: sepPools, sepTypeKey: sepTypeKey,
        sepMakeProblem: sepMakeProblem, sepRecord: sepRecord
    };
}
