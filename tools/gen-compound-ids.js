/**
 * compounds.json の不変 `id`（英語ケバブケース）を機械で作る（DEVELOPMENT.md §7-1）
 *
 *   node tools/gen-compound-ids.js            … 全件の「名前 → id」を出す（書き込まない）
 *   node tools/gen-compound-ids.js --check    … 一意性・未変換の残りだけを検査して終了コードで返す
 *   node tools/gen-compound-ids.js --write    … compounds.json へ `id` を差し込む（**行単位の挿入のみ**）
 *   node tools/gen-compound-ids.js --tsv      … qa へ渡す「名前<TAB>id」の一覧
 *
 * どの指定にも `--stages` を足すと相手が **stages.json**（パズルのお題データ）になる:
 *   node tools/gen-compound-ids.js --stages --check
 *   node tools/gen-compound-ids.js --stages --write
 * ⚠ **同名なら compounds.json の id をそのまま使う**（合流させて使うため）。
 * ⚠ stages は「同じ分子を複数のシリーズに置く」ので、**同名どうしの id の重複は正しい**。
 *
 * ⚠ **`id` は一度振ったら変えない。** 他アプリ（qa）の参照の主キーになる。
 * この道具は「まだ id を持たない行に振る」ためのもので、既にある id は上書きしない
 * （`--write` は id を持つ行を素通りする）。命名規則を変えたくなっても、
 * **既存の id は据え置いて新しい規則は新規分にだけ効かせる**こと。
 *
 * ⚠ compounds.json は「末尾追記のみ・整形し直さない」が規約（過去2回事故）。
 * そのため JSON.parse → JSON.stringify で書き戻すことは**しない**。
 * 「`"name"` を含む行に `"id"` を差し込む」以外の書き換えを一切しない実装にしてある。
 * 差し込みの前後で「id を除いた JSON」が完全に一致することを --write が自分で確かめる。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const COMPOUNDS = path.resolve(__dirname, '..', 'assembler', 'compounds.json');
const STAGES = path.resolve(__dirname, '..', 'assembler', 'stages.json');

/* ------------------------------------------------------------------ *
 * 1. 表示名の分解（主名 ＋ 別名）
 *
 * ライブラリの名前は「主名（別名1・別名2）」の形（DESIGN_compound_coverage.md §5.4）。
 * ⚠ 目印は**全角の（）だけ**。半角 `()` は複合置換基の書き方
 *   （`ギ酸(1-メチルブチル)`・`N-(1-メチルブチル)ホルムアミド`）なので分解しない。
 * ------------------------------------------------------------------ */
function mainName(name) {
    const i = name.indexOf('（');
    return i < 0 ? name : name.slice(0, i);
}

/* ------------------------------------------------------------------ *
 * 2. 個別に決めた id（規則で作ると読めない・慣用名・整合が要るもの）
 * ------------------------------------------------------------------ */
const OVERRIDES = {
    // 慣用名・生体分子（規則で綴っても読めないもの）
    'グリセリン': 'glycerol',
    'エチレングリコール': 'ethylene-glycol',
    'ジエチレングリコール': 'diethylene-glycol',
    '尿素': 'urea',
    '四塩化炭素': 'carbon-tetrachloride',
    '四臭化炭素': 'carbon-tetrabromide',
    'クロロホルム': 'chloroform',
    'ブロモホルム': 'bromoform',
    'ヨードホルム': 'iodoform',
    'シアン化水素': 'hydrogen-cyanide',
    '亜硝酸': 'nitrous-acid',
    '炭酸': 'carbonic-acid',
    '炭酸ジメチル': 'dimethyl-carbonate',
    'パラセタモール': 'paracetamol',
    'ニトログリセリン': 'nitroglycerin',
    'クメン': 'cumene',
    'メシチレン': 'mesitylene',
    'テトラリン': 'tetralin',
    'クロラール': 'chloral',
    'ジアセトンアルコール': 'diacetone-alcohol',
    'アセトンシアノヒドリン': 'acetone-cyanohydrin',
    '乳酸ニトリル': 'lactonitrile',
    'ヒドロキノン': 'hydroquinone',
    'カテコール': 'catechol',
    'レゾルシノール': 'resorcinol',
    'ピロガロール': 'pyrogallol',
    'フロログルシノール': 'phloroglucinol',
    'グアヤコール': 'guaiacol',
    'アニソール': 'anisole',
    'フェネトール': 'phenetole',
    'バニリン': 'vanillin',
    'アニスアルデヒド': 'anisaldehyde',
    'フルフラール': 'furfural',
    'フルフリルアルコール': 'furfuryl-alcohol',
    'アクロレイン': 'acrolein',
    'クロトンアルデヒド': 'crotonaldehyde',
    'グリオキサール': 'glyoxal',
    'メチルグリオキサール': 'methylglyoxal',
    'グリコールアルデヒド': 'glycolaldehyde',
    'ヒドロキシアセトン': 'hydroxyacetone',
    'ジヒドロキシアセトン': 'dihydroxyacetone',
    'マロンアルデヒド': 'malonaldehyde',
    'グルタルアルデヒド': 'glutaraldehyde',
    'フタルアルデヒド': 'phthalaldehyde',
    'イソフタルアルデヒド': 'isophthalaldehyde',
    'テレフタルアルデヒド': 'terephthalaldehyde',
    'サリチルアルデヒド': 'salicylaldehyde',
    'ベンズアルデヒド': 'benzaldehyde',
    'ベンズアミド': 'benzamide',
    'ホルムアミド': 'formamide',
    'アセトアミド': 'acetamide',
    'アセトアルデヒド': 'acetaldehyde',
    'アセトン': 'acetone',
    'アセトアニリド': 'acetanilide',
    'アセトフェノン': 'acetophenone',
    'プロピオフェノン': 'propiophenone',
    'ベンゾフェノン': 'benzophenone',
    'ベンゾニトリル': 'benzonitrile',
    'アクリロニトリル': 'acrylonitrile',
    'アクリルアミド': 'acrylamide',
    'オキサミド': 'oxamide',
    'マロンアミド': 'malonamide',
    'マロノニトリル': 'malononitrile',
    'スクシノニトリル': 'succinonitrile',
    'バレロニトリル': 'valeronitrile',
    'プロピオニトリル': 'propionitrile',
    'ブチロニトリル': 'butyronitrile',
    'スクシンイミド': 'succinimide',
    'エチレンジアミン': 'ethylenediamine',
    'ヘキサメチレンジアミン': 'hexamethylenediamine',
    '酸化エチレン': 'ethylene-oxide',
    'テトラヒドロピラン': 'tetrahydropyran',
    'テトラヒドロフラン': 'tetrahydrofuran',
    'ピロリジン': 'pyrrolidine',
    'ピペリジン': 'piperidine',
    'ピペラジン': 'piperazine',
    'ピラジン': 'pyrazine',
    'ピリミジン': 'pyrimidine',
    'イミダゾール': 'imidazole',
    'ピロール': 'pyrrole',
    'フラン': 'furan',
    'チオフェン': 'thiophene',
    'キノリン': 'quinoline',
    'イソキノリン': 'isoquinoline',
    'インドール': 'indole',
    'ナフタレン': 'naphthalene',
    'アントラセン': 'anthracene',
    'フェナントレン': 'phenanthrene',
    'ビフェニル': 'biphenyl',
    'ジフェニルメタン': 'diphenylmethane',
    'ジフェニルアミン': 'diphenylamine',
    'アゾベンゼン': 'azobenzene',
    'スチレン': 'styrene',
    'イソプレン': 'isoprene',
    'クロロプレン': 'chloroprene',
    'アレン': 'allene',
    'ベンゼン': 'benzene',
    'トルエン': 'toluene',
    'フェノール': 'phenol',
    'アニリン': 'aniline',
    'エタノール': 'ethanol',
    'メタノール': 'methanol',
    'ホルムアルデヒド': 'formaldehyde',
    'ケイ皮酸': 'cinnamic-acid',
    // 高分子（DESIGN_compound_coverage.md §18。単量体の id に `poly` を足すのではなく
    // 英語の慣用名をそのまま使う。`ナイロン66` は数字を残す）
    'ポリアセチレン': 'polyacetylene',
    'ポリビニルアルコール': 'polyvinyl-alcohol',
    'ナイロン66': 'nylon-66',
    // 規則で作ると読めないもの
    'ヘキサクロロシクロヘキサン': 'hexachlorocyclohexane',
    'デオキシリボース': 'deoxyribose',
    // 糖・アミノ酸（立体を id に写す。D/L・α/β は名前の一部として残す）
    'グリシン': 'glycine',
    'アラニン': 'alanine',
    'セリン': 'serine',
    'システイン': 'cysteine',
    'メチオニン': 'methionine',
    'バリン': 'valine',
    'ロイシン': 'leucine',
    'イソロイシン': 'isoleucine',
    'リシン': 'lysine',
    'フェニルアラニン': 'phenylalanine',
    'チロシン': 'tyrosine',
    'プロリン': 'proline',
    'トレオニン': 'threonine',
    'アスパラギン': 'asparagine',
    'グルタミン': 'glutamine',
    'グルタミン酸': 'glutamic-acid',
    'アスパラギン酸': 'aspartic-acid',
    'グリシルグリシン': 'glycylglycine',
    'セロビオース': 'cellobiose',
    'スクロース': 'sucrose',
    'マルトース': 'maltose',
    'ラクトース': 'lactose',
    // 油脂・セッケン
    'トリステアリン': 'tristearin',
    'トリオレイン': 'triolein',
    'ジステアリン酸グリセリド': 'glyceryl-distearate',
    'モノステアリン酸グリセリド': 'glyceryl-monostearate',
    'ナトリウムフェノキシド': 'sodium-phenoxide',
    // 環の慣用名（規則で作ると読めない）
    'ε-カプロラクタム': 'epsilon-caprolactam',
    'γ-ブチロラクトン': 'gamma-butyrolactone',
    'δ-バレロラクトン': 'delta-valerolactone',
    'ε-カプロラクトン': 'epsilon-caprolactone',
    '2-ピロリドン': '2-pyrrolidone',
    'N-メチル-2-ピロリドン': 'n-methyl-2-pyrrolidone',
    'p-ベンゾキノン': 'p-benzoquinone',
    // 名前の中に「／」を含む総称（シス/トランス未確定のまま置いてある。§5.3-5）
    'ブテン二酸': 'butenedioic-acid',
    // 略号つき
    '2,4,6-トリニトロトルエン': '2-4-6-trinitrotoluene',
    // 酸性塩は英語の語順（陽イオン → 水素 → 陰イオン）
    'フタル酸水素カリウム': 'potassium-hydrogen-phthalate'
};

/* ------------------------------------------------------------------ *
 * 3. 酸（3つの形をまとめて持つ）
 *    adj  … 「〜酸」そのもの（acetic-acid）
 *    salt … 塩・エステルにしたときの形（acetate）
 * ------------------------------------------------------------------ */
const ACIDS = {
    '酢酸': { adj: 'acetic', salt: 'acetate' },
    'ギ酸': { adj: 'formic', salt: 'formate' },
    'プロピオン酸': { adj: 'propionic', salt: 'propionate' },
    '酪酸': { adj: 'butyric', salt: 'butyrate' },
    'イソ酪酸': { adj: 'isobutyric', salt: 'isobutyrate' },
    '吉草酸': { adj: 'valeric', salt: 'valerate' },
    'イソ吉草酸': { adj: 'isovaleric', salt: 'isovalerate' },
    '乳酸': { adj: 'lactic', salt: 'lactate' },
    'シュウ酸': { adj: 'oxalic', salt: 'oxalate' },
    'マロン酸': { adj: 'malonic', salt: 'malonate' },
    'メチルマロン酸': { adj: 'methylmalonic', salt: 'methylmalonate' },
    'コハク酸': { adj: 'succinic', salt: 'succinate' },
    'グルタル酸': { adj: 'glutaric', salt: 'glutarate' },
    'アジピン酸': { adj: 'adipic', salt: 'adipate' },
    'ピメリン酸': { adj: 'pimelic', salt: 'pimelate' },
    'スベリン酸': { adj: 'suberic', salt: 'suberate' },
    'アゼライン酸': { adj: 'azelaic', salt: 'azelate' },
    'セバシン酸': { adj: 'sebacic', salt: 'sebacate' },
    'マレイン酸': { adj: 'maleic', salt: 'maleate' },
    'フマル酸': { adj: 'fumaric', salt: 'fumarate' },
    'アクリル酸': { adj: 'acrylic', salt: 'acrylate' },
    'メタクリル酸': { adj: 'methacrylic', salt: 'methacrylate' },
    'クロトン酸': { adj: 'crotonic', salt: 'crotonate' },
    'ビニル酢酸': { adj: 'vinylacetic', salt: 'vinylacetate' },
    'フェニル酢酸': { adj: 'phenylacetic', salt: 'phenylacetate' },
    'アセト酢酸': { adj: 'acetoacetic', salt: 'acetoacetate' },
    'オキサロ酢酸': { adj: 'oxaloacetic', salt: 'oxaloacetate' },
    '安息香酸': { adj: 'benzoic', salt: 'benzoate' },
    'フタル酸': { adj: 'phthalic', salt: 'phthalate' },
    'イソフタル酸': { adj: 'isophthalic', salt: 'isophthalate' },
    'テレフタル酸': { adj: 'terephthalic', salt: 'terephthalate' },
    'サリチル酸': { adj: 'salicylic', salt: 'salicylate' },
    'トルイル酸': { adj: 'toluic', salt: 'toluate' },
    'マンデル酸': { adj: 'mandelic', salt: 'mandelate' },
    'クエン酸': { adj: 'citric', salt: 'citrate' },
    'リンゴ酸': { adj: 'malic', salt: 'malate' },
    '酒石酸': { adj: 'tartaric', salt: 'tartrate' },
    'ピルビン酸': { adj: 'pyruvic', salt: 'pyruvate' },
    'グリコール酸': { adj: 'glycolic', salt: 'glycolate' },
    'グリオキシル酸': { adj: 'glyoxylic', salt: 'glyoxylate' },
    'グリセリン酸': { adj: 'glyceric', salt: 'glycerate' },
    'グルコン酸': { adj: 'gluconic', salt: 'gluconate' },
    'レブリン酸': { adj: 'levulinic', salt: 'levulinate' },
    'ピバル酸': { adj: 'pivalic', salt: 'pivalate' },
    'ヒドラクリル酸': { adj: 'hydracrylic', salt: 'hydracrylate' },
    'ラウリン酸': { adj: 'lauric', salt: 'laurate' },
    'ミリスチン酸': { adj: 'myristic', salt: 'myristate' },
    'パルミチン酸': { adj: 'palmitic', salt: 'palmitate' },
    'ステアリン酸': { adj: 'stearic', salt: 'stearate' },
    'オレイン酸': { adj: 'oleic', salt: 'oleate' },
    'リノール酸': { adj: 'linoleic', salt: 'linoleate' },
    'リノレン酸': { adj: 'linolenic', salt: 'linolenate' },
    'ニコチン酸': { adj: 'nicotinic', salt: 'nicotinate' },
    'スルファニル酸': { adj: 'sulfanilic', salt: 'sulfanilate' },
    'アントラニル酸': { adj: 'anthranilic', salt: 'anthranilate' },
    'ケイ皮酸': { adj: 'cinnamic', salt: 'cinnamate' },
    'ピクリン酸': { adj: 'picric', salt: 'picrate' },
    'グルタミン酸': { adj: 'glutamic', salt: 'glutamate' },
    'アスパラギン酸': { adj: 'aspartic', salt: 'aspartate' },
    'ケトグルタル酸': { adj: 'ketoglutaric', salt: 'ketoglutarate' },
    '炭酸': { adj: 'carbonic', salt: 'carbonate' }
};

// 語幹（アルカン）→ 系統名の材料。`ブタン酸` のように規則で作れるものはここから合成する
const ALKANE_STEMS = {
    'メタン': 'meth', 'エタン': 'eth', 'プロパン': 'prop', 'ブタン': 'but',
    'ペンタン': 'pent', 'ヘキサン': 'hex', 'ヘプタン': 'hept', 'オクタン': 'oct',
    'ノナン': 'non', 'デカン': 'dec'
};

/**
 * 「〜酸」を3つの形（adj / salt）で引く。
 * 表に無くても、`ブタン酸`（アルカン語幹＋酸）・`〜スルホン酸`・`〜カルボン酸`・
 * `〜ン二酸` は規則で作れる。作れないものは null を返して呼び出し側で気づけるようにする。
 */
function acidForms(jp) {
    if (ACIDS[jp]) return ACIDS[jp];
    let m;
    // ブタン二酸 → butanedioic-acid / butanedioate
    if ((m = jp.match(/^(.+?)二酸$/)) && ALKANE_STEMS[m[1]]) {
        return { adj: ALKANE_STEMS[m[1]] + 'anedioic', salt: ALKANE_STEMS[m[1]] + 'anedioate' };
    }
    // ブタン酸 → butanoic-acid / butanoate
    if ((m = jp.match(/^(.+?)酸$/)) && ALKANE_STEMS[m[1]]) {
        return { adj: ALKANE_STEMS[m[1]] + 'anoic', salt: ALKANE_STEMS[m[1]] + 'anoate' };
    }
    // メタンスルホン酸・ベンゼンスルホン酸・p-トルエンスルホン酸
    if ((m = jp.match(/^(.+?)スルホン酸$/))) {
        const head = translitPrefix(m[1]);
        if (head !== null) return { adj: head + 'sulfonic', salt: head + 'sulfonate' };
    }
    // シクロヘキサンカルボン酸
    if ((m = jp.match(/^(.+?)カルボン酸$/))) {
        const head = translitPrefix(m[1]);
        if (head !== null) return { adj: head + 'carboxylic', salt: head + 'carboxylate' };
    }
    return null;
}

/**
 * 「（置換基）＋（酸）」を後ろから一番長く一致する酸で割る。
 * `p-ヒドロキシ安息香酸` → { head: 'p-hydroxy', forms: 安息香酸 }
 * `2,2-ジメチルプロパン酸` → { head: '2-2-dimethyl', forms: プロパン酸 }
 */
function resolveAcid(jp) {
    if (!jp.endsWith('酸')) return null;
    for (let cut = 0; cut < jp.length; cut++) {
        const forms = acidForms(jp.slice(cut));
        if (!forms) continue;
        const head = cut === 0 ? '' : translitPrefix(jp.slice(0, cut));
        if (head === null) continue;
        return { head, forms };
    }
    return null;
}

/* ------------------------------------------------------------------ *
 * 4. 形態素の辞書（最長一致）
 *    ここに無いカタカナ／漢字が残ったら `translit` は null を返す ＝ 黙って
 *    それらしい id を作らない（--check がその件数を出す）
 * ------------------------------------------------------------------ */
const MORPHEMES = {
    // 環・骨格（長いものから引かれるよう、辞書は長さ順に並べ替えて使う）
    'シクロプロパン': 'cyclopropane', 'シクロブタン': 'cyclobutane', 'シクロペンタン': 'cyclopentane',
    'シクロヘキサン': 'cyclohexane', 'シクロヘプタン': 'cycloheptane', 'シクロオクタン': 'cyclooctane',
    'シクロペンテン': 'cyclopentene', 'シクロヘキセン': 'cyclohexene',
    'シクロヘキサジエン': 'cyclohexadiene', 'シクロペンタジエン': 'cyclopentadiene',
    'シクロヘキサンジオン': 'cyclohexanedione', 'シクロペンタンジオン': 'cyclopentanedione',
    'シクロヘキサノン': 'cyclohexanone', 'シクロペンタノン': 'cyclopentanone',
    'シクロブタノン': 'cyclobutanone', 'シクロヘプタノン': 'cycloheptanone',
    'シクロオクタノン': 'cyclooctanone',
    'シクロヘキサノール': 'cyclohexanol', 'シクロペンタノール': 'cyclopentanol',
    'シクロヘキセン-1-オン': 'cyclohexen-1-one', 'シクロペンテン-1-オン': 'cyclopenten-1-one',
    'シクロヘキサンカルボアルデヒド': 'cyclohexanecarbaldehyde',
    'シクロペンタンカルボアルデヒド': 'cyclopentanecarbaldehyde',
    'シクロヘキサンカルボン酸': 'cyclohexanecarboxylic-acid',
    'シクロヘキシルメタノール': 'cyclohexylmethanol',
    'シクロヘキシルエタノン': 'cyclohexylethanone',
    'シクロペンチルエタノン': 'cyclopentylethanone',
    'シクロヘキシルアミン': 'cyclohexylamine', 'シクロペンチルアミン': 'cyclopentylamine',
    'シクロヘキシル': 'cyclohexyl', 'シクロペンチル': 'cyclopentyl',
    'ベンゼン': 'benzene', 'トルエン': 'toluene', 'ナフタレン': 'naphthalene',
    'ナフトール': 'naphthol', 'フェノール': 'phenol', 'アニリン': 'aniline',
    'ベンズアルデヒド': 'benzaldehyde', 'アセトフェノン': 'acetophenone',
    'ベンゾキノン': 'benzoquinone', 'トルアルデヒド': 'tolualdehyde',
    'トルイジン': 'toluidine', 'キシレン': 'xylene',
    'フェニレンジアミン': 'phenylenediamine',
    'ジヒドロキシベンゼン': 'dihydroxybenzene', 'トリヒドロキシベンゼン': 'trihydroxybenzene',
    'ジホルミルベンゼン': 'diformylbenzene', 'ジアセチルベンゼン': 'diacetylbenzene',
    'ベンゼンジスルホン酸': 'benzenedisulfonic-acid',
    'ベンゼンスルホン酸': 'benzenesulfonic-acid',
    'アセチルベンズアルデヒド': 'acetylbenzaldehyde',
    'ヒドロキシアセトフェノン': 'hydroxyacetophenone',
    'メチルアセトフェノン': 'methylacetophenone',
    'アミノアセトフェノン': 'aminoacetophenone',
    'クロロアセトフェノン': 'chloroacetophenone',
    'ブロモアセトフェノン': 'bromoacetophenone',
    'ニトロアセトフェノン': 'nitroacetophenone',
    'ヒドロキシベンズアルデヒド': 'hydroxybenzaldehyde',
    'メチルベンズアルデヒド': 'methylbenzaldehyde',
    'メトキシベンズアルデヒド': 'methoxybenzaldehyde',
    'アミノベンズアルデヒド': 'aminobenzaldehyde',
    'クロロベンズアルデヒド': 'chlorobenzaldehyde',
    'ブロモベンズアルデヒド': 'bromobenzaldehyde',
    'ニトロベンズアルデヒド': 'nitrobenzaldehyde',
    'アミノフェノール': 'aminophenol', 'ニトロフェノール': 'nitrophenol',
    'クロロフェノール': 'chlorophenol', 'ブロモフェノール': 'bromophenol',
    'ニトロアニリン': 'nitroaniline', 'クロロアニリン': 'chloroaniline',
    'ブロモアニリン': 'bromoaniline',
    'ニトロトルエン': 'nitrotoluene', 'クロロトルエン': 'chlorotoluene',
    'ブロモトルエン': 'bromotoluene',
    'ニトロベンゼン': 'nitrobenzene', 'ジニトロベンゼン': 'dinitrobenzene',
    'トリニトロベンゼン': 'trinitrobenzene',
    'クロロベンゼン': 'chlorobenzene', 'ジクロロベンゼン': 'dichlorobenzene',
    'ブロモベンゼン': 'bromobenzene', 'ジブロモベンゼン': 'dibromobenzene',
    'ブロモクロロベンゼン': 'bromochlorobenzene',
    'クロロニトロベンゼン': 'chloronitrobenzene', 'ブロモニトロベンゼン': 'bromonitrobenzene',
    'ニトロナフタレン': 'nitronaphthalene', 'メチルナフタレン': 'methylnaphthalene',
    'メトキシフェノール': 'methoxyphenol', 'エトキシベンゼン': 'ethoxybenzene',
    'メトキシベンゼン': 'methoxybenzene',
    'トリメチルベンゼン': 'trimethylbenzene',
    'トリブロモフェノール': 'tribromophenol', 'トリクロロフェノール': 'trichlorophenol',
    'ジニトロフェノール': 'dinitrophenol', 'ジニトロトルエン': 'dinitrotoluene',
    'エチニルベンゼン': 'ethynylbenzene', 'フェニルアセチレン': 'phenylacetylene',
    // 鎖（アルカン・アルケン・アルキン）
    'メタン': 'methane', 'エタン': 'ethane', 'プロパン': 'propane', 'ブタン': 'butane',
    'ペンタン': 'pentane', 'ヘキサン': 'hexane', 'ヘプタン': 'heptane', 'オクタン': 'octane',
    'ノナン': 'nonane', 'デカン': 'decane',
    'エチレン': 'ethylene', 'プロペン': 'propene', 'ブテン': 'butene', 'ペンテン': 'pentene',
    'ヘキセン': 'hexene', 'ヘプテン': 'heptene', 'オクテン': 'octene',
    'アセチレン': 'acetylene', 'プロピン': 'propyne', 'ブチン': 'butyne', 'ペンチン': 'pentyne',
    'ヘキシン': 'hexyne', 'ヘプチン': 'heptyne', 'オクチン': 'octyne',
    'ブタジエン': 'butadiene', 'ペンタジエン': 'pentadiene', 'プロパジエン': 'propadiene',
    // 官能基の語尾
    'メタノール': 'methanol', 'エタノール': 'ethanol', 'プロパノール': 'propanol',
    'ブタノール': 'butanol', 'ペンタノール': 'pentanol', 'ヘキサノール': 'hexanol',
    'ヘプタノール': 'heptanol', 'オクタノール': 'octanol', 'ノナノール': 'nonanol',
    'デカノール': 'decanol',
    'プロパナール': 'propanal', 'ブタナール': 'butanal', 'ペンタナール': 'pentanal',
    'ヘキサナール': 'hexanal', 'ヘプタナール': 'heptanal', 'オクタナール': 'octanal',
    'プロパノン': 'propanone', 'ブタノン': 'butanone', 'ペンタノン': 'pentanone',
    'ヘキサノン': 'hexanone', 'ヘプタノン': 'heptanone', 'オクタノン': 'octanone',
    'ブタンジオン': 'butanedione', 'ペンタンジオン': 'pentanedione', 'ヘキサンジオン': 'hexanedione',
    'プロパンジオール': 'propanediol', 'プロパンジアール': 'propanedial',
    'ペンタンジアール': 'pentanedial',
    'プロパンジアミン': 'propanediamine', 'ブタンジアミン': 'butanediamine',
    'ペンタンジアミン': 'pentanediamine',
    'プロパンジニトリル': 'propanedinitrile', 'ブタンジニトリル': 'butanedinitrile',
    'プロパンニトリル': 'propanenitrile', 'ブタンニトリル': 'butanenitrile',
    'ペンタンニトリル': 'pentanenitrile', 'ヘキサンニトリル': 'hexanenitrile',
    'プロパンアミド': 'propanamide', 'ブタンアミド': 'butanamide',
    'ペンタンアミド': 'pentanamide', 'ヘキサンアミド': 'hexanamide',
    'ホルムアミド': 'formamide', 'アセトアミド': 'acetamide',
    'アセトアルデヒド': 'acetaldehyde', 'アセトン': 'acetone',
    // 置換基
    'メチル': 'methyl', 'エチル': 'ethyl', 'プロピル': 'propyl', 'ブチル': 'butyl',
    'ペンチル': 'pentyl', 'ヘキシル': 'hexyl', 'アミル': 'amyl',
    'イソプロピル': 'isopropyl', 'イソブチル': 'isobutyl', 'イソペンチル': 'isopentyl',
    'イソアミル': 'isoamyl', 'ネオペンチル': 'neopentyl',
    'ビニル': 'vinyl', 'アリル': 'allyl', 'ベンジル': 'benzyl', 'フェニル': 'phenyl',
    'エチニル': 'ethynyl', 'プロパルギル': 'propargyl', 'クロチル': 'crotyl',
    'アセチル': 'acetyl', 'ベンゾイル': 'benzoyl', 'プロピオニル': 'propionyl',
    'ホルミル': 'formyl',
    'クロロ': 'chloro', 'ブロモ': 'bromo', 'ヨード': 'iodo', 'フルオロ': 'fluoro',
    'ニトロ': 'nitro', 'アミノ': 'amino', 'ヒドロキシ': 'hydroxy', 'メトキシ': 'methoxy',
    'エトキシ': 'ethoxy', 'オキソ': 'oxo', 'ケト': 'keto', 'スルホ': 'sulfo',
    // `アルキル` は総称の基（アルキルベンゼンスルホン酸ナトリウム）。図では R で描く
    'アルキル': 'alkyl',
    'イソ': 'iso', 'ジ': 'di', 'トリ': 'tri', 'テトラ': 'tetra', 'モノ': 'mono',
    'ヘミ': 'hemi',
    // 語尾になる語
    'アミン': 'amine', 'エーテル': '-ether', 'ケトン': '-ketone', 'アルコール': '-alcohol',
    'オール': 'ol', 'オン': 'one', 'アール': 'al', 'ニトリル': 'nitrile',
    'アミド': 'amide', 'ジアミド': 'diamide',
    'ナトリウム': 'sodium', 'カリウム': 'potassium',
    // 環系のその他
    'ジオキサン': 'dioxane', 'オキサン': 'oxane', 'オキソラン': 'oxolane',
    'ジアジン': 'diazine', 'ピラン': 'pyran', 'フラン': 'furan',
    'テトラヒドロナフタレン': 'tetrahydronaphthalene',
    // 糖
    'グルコース': 'glucose', 'ガラクトース': 'galactose', 'マンノース': 'mannose',
    'フルクトース': 'fructose', 'アロース': 'allose', 'グロース': 'gulose',
    'グルコピラノース': 'glucopyranose', 'ガラクトピラノース': 'galactopyranose',
    'マンノピラノース': 'mannopyranose', 'フルクトフラノース': 'fructofuranose',
    'アロピラノース': 'allopyranose', 'グロピラノース': 'gulopyranose',
    'グリセルアルデヒド': 'glyceraldehyde',
    // 漢字（塩・付加語）
    '塩化': 'chloride', '臭化': 'bromide', 'ヨウ化': 'iodide',
    '水素': 'hydrogen', '無水': 'anhydride',
    // stages.json にしか出ない語（お題データ側。DEVELOPMENT.md §7-1c）
    '水': 'water', 'アセトニトリル': 'acetonitrile', 'クレゾール': 'cresol',
    'ピリジン': 'pyridine',
    // 幾何（シス/トランスは名前の一部として id に残す）
    'シス': 'cis', 'トランス': 'trans',
    // 慣用名でも「前に何かが付く形」で現れるもの
    'スチレン': 'styrene', 'アゾベンゼン': 'azobenzene', 'フェニルアゾフェノール': 'phenylazophenol',
    'プロピオンアルデヒド': 'propionaldehyde', 'プロピオンアミド': 'propionamide',
    'ブチルアルデヒド': 'butyraldehyde', 'イソブチルアルデヒド': 'isobutyraldehyde',
    'バレルアルデヒド': 'valeraldehyde', 'イソバレルアルデヒド': 'isovaleraldehyde',
    'ピバルアルデヒド': 'pivalaldehyde', '吉草アルデヒド': 'valeraldehyde',
    // アミノ酸・糖（D-/L-・α-/β- が前に付く形で出る）
    'グリシン': 'glycine', 'アラニン': 'alanine', 'セリン': 'serine',
    'システイン': 'cysteine', 'メチオニン': 'methionine', 'バリン': 'valine',
    'ロイシン': 'leucine', 'リシン': 'lysine', 'チロシン': 'tyrosine',
    'プロリン': 'proline', 'トレオニン': 'threonine',
    'アスパラギン': 'asparagine', 'グルタミン': 'glutamine'
};

// 最長一致で引くため、キーを長い順に並べておく
const MORPHEME_KEYS = Object.keys(MORPHEMES).sort((a, b) => b.length - a.length);

const GREEK = { 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ω': 'omega' };

/**
 * 置換基の並び（酸・エステルの「前半」など）をローマ字にする。
 * カタカナ／漢字は連結し、日本語側にあったハイフン・コンマは `-` として残す。
 * 辞書に無い文字が残ったら **null**（呼び出し側で気づけるように、それらしい id を作らない）
 */
function translitPrefix(jp) {
    let out = '';
    let i = 0;
    while (i < jp.length) {
        const ch = jp[i];
        // ASCII（位置番号・N・o/m/p・sec/tert・n）はそのまま小文字で残す
        if (/[0-9A-Za-z]/.test(ch)) {
            let j = i;
            while (j < jp.length && /[0-9A-Za-z]/.test(jp[j])) j++;
            out += jp.slice(i, j).toLowerCase();
            i = j;
            continue;
        }
        if (ch === '-' || ch === ',' || ch === '，' || ch === '・' || ch === '／') { out += '-'; i++; continue; }
        if (ch === '(' || ch === ')') { out += '-'; i++; continue; }
        if (GREEK[ch]) { out += GREEK[ch]; i++; continue; }
        const hit = MORPHEME_KEYS.find(k => jp.startsWith(k, i));
        if (!hit) return null;
        out += MORPHEMES[hit];
        i += hit.length;
    }
    return out;
}

/* ------------------------------------------------------------------ *
 * 5. 主名 → id
 * ------------------------------------------------------------------ */
// 塩・エステルの「あとに来る側」（この語で終わっていて、前半が「〜酸」ならエステル／塩）
const ESTER_TAILS = [
    '水素カリウム', 'ナトリウム', 'カリウム',
    'ジメチル', 'ジエチル',
    'イソプロピル', 'イソブチル', 'イソペンチル', 'イソアミル', 'ネオペンチル',
    'メチル', 'エチル', 'プロピル', 'ブチル', 'ペンチル', 'ヘキシル', 'アミル',
    'ビニル', 'ベンジル', 'フェニル'
].sort((a, b) => b.length - a.length);

function normalizeId(s) {
    return s
        .replace(/[^0-9a-z-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

function compoundId(displayName) {
    const jp = mainName(displayName);
    if (OVERRIDES[jp]) return OVERRIDES[jp];

    // ---- 無水〜酸 → 〜-anhydride
    let m = jp.match(/^無水(.+)$/);
    if (m) {
        const a = acidForms(m[1]);
        if (a) return normalizeId(a.adj + '-anhydride');
    }
    // ---- 塩化〜 / 臭化〜 → 〜-chloride / 〜-bromide
    m = jp.match(/^(塩化|臭化|ヨウ化)(.+)$/);
    if (m) {
        const head = translitPrefix(m[2]);
        const tail = { '塩化': 'chloride', '臭化': 'bromide', 'ヨウ化': 'iodide' }[m[1]];
        if (head !== null) return normalizeId(head + '-' + tail);
    }
    // ---- エステル・塩（日本語は「酸 → アルキル」の順。英語は逆順）
    for (const tail of ESTER_TAILS) {
        if (!jp.endsWith(tail)) continue;
        let head = jp.slice(0, jp.length - tail.length);
        let alkylJp = tail;
        // `ギ酸sec-ブチル` … 酸の直後に来る sec-/tert-/n- は基の側の飾り
        const latin = head.match(/^(.*酸)([A-Za-z]+-)$/);
        if (latin) { head = latin[1]; alkylJp = latin[2] + tail; }
        // `ギ酸(1-メチルブチル)` のような括弧つきの基
        const bracket = head.match(/^(.*酸)\((.+)\)$/);
        if (bracket) { head = bracket[1]; alkylJp = bracket[2] + tail; }
        const a = resolveAcid(head);
        const alkyl = translitPrefix(alkylJp);
        if (a && alkyl !== null) return normalizeId(alkyl + '-' + a.head + a.forms.salt);
    }
    // 括弧の基だけで終わる形（`ギ酸(1-メチルブチル)`）
    m = jp.match(/^(.*酸)\((.+)\)$/);
    if (m) {
        const a = resolveAcid(m[1]);
        const alkyl = translitPrefix(m[2]);
        if (a && alkyl !== null) return normalizeId(alkyl + '-' + a.head + a.forms.salt);
    }
    // ---- 「〜酸」（エステルでない酸そのもの）
    if (jp.endsWith('酸')) {
        const a = resolveAcid(jp);
        return a ? normalizeId(a.head + a.forms.adj + '-acid') : null;
    }
    // ---- それ以外は素直に形態素へ
    const t = translitPrefix(jp);
    return t === null ? null : normalizeId(t);
}

/* ------------------------------------------------------------------ *
 * 6. CLI
 * ------------------------------------------------------------------ */
function readEntries(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildAll(target) {
    if (target === 'stages') {
        // ⚠ **compounds と同名なら、compounds の id をそのまま使う。**
        // `getCompoundLibrary()` は両者を合流させて同名・同構造を畳むので、
        // 別々の id を振ると「同じ分子に2つの id」ができて主キーの意味が消える
        const byName = new Map(readEntries(COMPOUNDS).map(c => [c.name, c.id]));
        return readEntries(STAGES).map(s => ({
            name: s.name,
            id: s.id || byName.get(s.name) || compoundId(s.name)
        }));
    }
    return readEntries(COMPOUNDS).map(e => ({ name: e.name, id: e.id || compoundId(e.name) }));
}

/**
 * ⚠ **`allowSameName` は stages.json 専用。**
 * `id` は**化合物**の主キーであってステージ行の主キーではない。
 * 同じ分子を複数のシリーズに置くこと（エチレンはアルケン編と高分子編の2か所）は
 * 設計どおりなので、**同名どうしの重複だけは通す**。名前が違うのに id が同じなら不合格。
 */
function check(rows, allowSameName) {
    const problems = [];
    rows.filter(r => !r.id).forEach(r => problems.push(`id を作れません: ${r.name}`));
    const seen = new Map();
    rows.forEach(r => {
        if (!r.id) return;
        const prev = seen.get(r.id);
        if (prev === undefined) { seen.set(r.id, r.name); return; }
        if (allowSameName && prev === r.name) return;   // 同じ分子の再掲は許す
        problems.push(`id が重複: ${r.id}（${prev} / ${r.name}）`);
    });
    rows.forEach(r => {
        if (r.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id)) {
            problems.push(`ケバブケースでない id: ${r.id}（${r.name}）`);
        }
    });
    return problems;
}

/**
 * 2つのファイルの id が食い違っていないかを見る（合流させて使うため）。
 * - 同名なのに id が違う ＝ 合流後に同じ分子が2つの id を持つ
 * - 名前が違うのに id が同じ ＝ 主キーが衝突する
 */
function checkAcross() {
    const problems = [];
    const C = readEntries(COMPOUNDS).map(e => ({ name: e.name, id: e.id || compoundId(e.name) }));
    const S = readEntries(STAGES).map(e => ({ name: e.name, id: e.id || compoundId(e.name) }));
    const cByName = new Map(C.map(r => [r.name, r.id]));
    const cById = new Map(C.map(r => [r.id, r.name]));
    S.forEach(r => {
        const same = cByName.get(r.name);
        if (same !== undefined && same !== r.id) {
            problems.push(`同名なのに id が違う: 「${r.name}」 compounds=${same} / stages=${r.id}`);
        }
        const owner = cById.get(r.id);
        if (owner !== undefined && owner !== r.name) {
            problems.push(`名前が違うのに id が同じ: ${r.id}（compounds「${owner}」 / stages「${r.name}」）`);
        }
    });
    return problems;
}

/**
 * compounds.json へ `id` を差し込む。
 * **`"name"` を含む行以外は1バイトも触らない**（改行コード・字下げ・キーの順序を保つ）。
 */
/**
 * ⚠ `stages.json` は**パズルのお題データ**でもある。座標や結合が1つでも動けば
 * お題の判定が変わって**パズルが壊れる**ので、書き込みの直前に
 * 「id を除いた JSON が完全一致するか」「キーの並びが同じか」をここで必ず確かめる。
 */
function write(file, rows) {
    const raw = fs.readFileSync(file, 'utf8');
    const before = JSON.parse(raw);
    const lines = raw.split('\r\n');
    let n = 0, skipped = 0;
    const out = lines.map(line => {
        if (!line.includes('"name"')) return line;
        const row = rows[n++];
        if (line.includes('"id"')) { skipped++; return line; }
        const id = row.id;
        if (!id) throw new Error(`id が無い: ${row.name}`);
        // 形は3通り（詰めて1行 / 字下げつき1行 / 整形済みの複数行）
        if (/^(\s*)\{"name":/.test(line)) {
            return line.replace(/^(\s*)\{"name":/, `$1{"id":${JSON.stringify(id)},"name":`);
        }
        const indent = line.match(/^(\s*)/)[1];
        return `${indent}"id": ${JSON.stringify(id)},\r\n${line}`;
    });
    if (n !== rows.length) throw new Error(`"name" 行が ${n}・エントリが ${rows.length} で合いません`);
    const next = out.join('\r\n');
    // 差し込み以外の変更が無いことを、ここで自分で確かめる
    const after = JSON.parse(next);
    if (after.length !== before.length) throw new Error('件数が変わりました');
    for (let i = 0; i < before.length; i++) {
        const a = { ...after[i] };
        delete a.id;
        if (JSON.stringify(a) !== JSON.stringify(before[i])) {
            throw new Error(`id 以外が変わりました: ${before[i].name}`);
        }
        if (Object.keys(a).join(',') !== Object.keys(before[i]).join(',')) {
            throw new Error(`キーの並びが変わりました: ${before[i].name}`);
        }
    }
    fs.writeFileSync(file, next, 'utf8');
    console.log(`id を ${n - skipped} 件差し込みました（既に id があって素通りした行: ${skipped}）`);
}

if (require.main === module) {
    const args = process.argv.slice(2);
    // `--stages` を付けると相手が stages.json になる（既定は compounds.json）
    const target = args.includes('--stages') ? 'stages' : 'compounds';
    const file = target === 'stages' ? STAGES : COMPOUNDS;
    const rows = buildAll(target);
    // ⚠ stages は「同じ分子を複数のシリーズに置く」ことが設計どおりなので、
    //    **同名どうしの重複だけ**通す（名前が違うのに同じ id なら不合格）。
    //    2ファイル間の食い違いは、どちらを見ているときも必ず検査する
    const problems = check(rows, target === 'stages').concat(checkAcross());
    if (args.includes('--tsv')) {
        rows.forEach(r => console.log(`${r.name}\t${r.id || ''}`));
    } else if (args.includes('--write')) {
        if (problems.length) {
            console.log(`❌ ${problems.length} 件の問題があるので書き込みません:`);
            problems.forEach(p => console.log('  - ' + p));
            process.exit(1);
        }
        write(file, rows);
    } else if (!args.includes('--check')) {
        rows.forEach(r => console.log(`${(r.id || '(作れません)').padEnd(42)} ${r.name}`));
    }
    // ⚠ **まとめは標準エラーへ出す。** `--tsv > ids.tsv` がそのまま qa へ渡せる
    // データファイルになるように（まとめが混ざると1行目から使えない）
    const log = (s) => process.stderr.write(s + '\n');
    const uniq = new Set(rows.map(r => r.id)).size;
    log(`対象 ${path.basename(file)} ${rows.length} 件 / 一意な id ${uniq} 件` +
        (rows.length !== uniq ? `（同じ分子の再掲 ${rows.length - uniq} 件を含む）` : ''));
    if (problems.length) {
        log(`❌ ${problems.length} 件の問題:`);
        problems.forEach(p => log('  - ' + p));
        process.exit(1);
    }
    log('✅ 全件に id が作れます（2ファイル間の食い違いも 0）');
}

module.exports = { compoundId, mainName };
