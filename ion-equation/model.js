"use strict";
/* model.js — 化学モデル（DOM非依存の純粋ロジック）
   化学種の定義・電離表・ステージ定義・原子数集計・係数判定。 */

const SPECIES = {
  // 分子（投入する形・式の項になる形）
  "HCl":     { disp: "HCl",      name: "塩化水素（塩酸）",   atoms: { H: 1, Cl: 1 },       charge: 0 },
  "NaOH":    { disp: "NaOH",     name: "水酸化ナトリウム",   atoms: { Na: 1, O: 1, H: 1 }, charge: 0 },
  "H2SO4":   { disp: "H₂SO₄",   name: "硫酸",               atoms: { H: 2, S: 1, O: 4 },  charge: 0 },
  "Ca(OH)2": { disp: "Ca(OH)₂", name: "水酸化カルシウム",   atoms: { Ca: 1, O: 2, H: 2 }, charge: 0 },
  "AgNO3":   { disp: "AgNO₃",   name: "硝酸銀",             atoms: { Ag: 1, N: 1, O: 3 }, charge: 0 },
  "BaCl2":   { disp: "BaCl₂",   name: "塩化バリウム",       atoms: { Ba: 1, Cl: 2 },      charge: 0 },
  "HNO3":    { disp: "HNO₃",    name: "硝酸",               atoms: { H: 1, N: 1, O: 3 },  charge: 0 },
  "KOH":     { disp: "KOH",      name: "水酸化カリウム",     atoms: { K: 1, O: 1, H: 1 },  charge: 0 },
  "KNO3":    { disp: "KNO₃",    name: "硝酸カリウム",       atoms: { K: 1, N: 1, O: 3 },  charge: 0 },
  "Ba(OH)2": { disp: "Ba(OH)₂", name: "水酸化バリウム",     atoms: { Ba: 1, O: 2, H: 2 }, charge: 0 },
  "CuSO4":   { disp: "CuSO₄",   name: "硫酸銅(Ⅱ)",         atoms: { Cu: 1, S: 1, O: 4 }, charge: 0 },
  "Cu(OH)2": { disp: "Cu(OH)₂", name: "水酸化銅(Ⅱ)（青白色の沈殿）", atoms: { Cu: 1, O: 2, H: 2 }, charge: 0 },
  "Na2SO3":  { disp: "Na₂SO₃", name: "亜硫酸ナトリウム",   atoms: { Na: 2, S: 1, O: 3 }, charge: 0 },
  "H2SO3":   { disp: "H₂SO₃",  name: "亜硫酸（不安定）",   atoms: { H: 2, S: 1, O: 3 },  charge: 0 },
  "SO2":     { disp: "SO₂",     name: "二酸化硫黄",         atoms: { S: 1, O: 2 },        charge: 0 },
  "Na2CO3":  { disp: "Na₂CO₃", name: "炭酸ナトリウム",     atoms: { Na: 2, C: 1, O: 3 }, charge: 0 },
  "H2CO3":   { disp: "H₂CO₃",  name: "炭酸（不安定な中間体）", atoms: { H: 2, C: 1, O: 3 }, charge: 0 },
  "CO2":     { disp: "CO₂",     name: "二酸化炭素",         atoms: { C: 1, O: 2 },        charge: 0 },
  "H2O":     { disp: "H₂O",     name: "水",                 atoms: { H: 2, O: 1 },        charge: 0 },
  "NaCl":    { disp: "NaCl",     name: "塩化ナトリウム",     atoms: { Na: 1, Cl: 1 },      charge: 0 },
  "Na2SO4":  { disp: "Na₂SO₄", name: "硫酸ナトリウム",     atoms: { Na: 2, S: 1, O: 4 }, charge: 0 },
  "CaCl2":   { disp: "CaCl₂",   name: "塩化カルシウム",     atoms: { Ca: 1, Cl: 2 },      charge: 0 },
  "NaNO3":   { disp: "NaNO₃",   name: "硝酸ナトリウム",     atoms: { Na: 1, N: 1, O: 3 }, charge: 0 },
  "AgCl":    { disp: "AgCl",     name: "塩化銀（沈殿）",     atoms: { Ag: 1, Cl: 1 },      charge: 0 },
  "BaSO4":   { disp: "BaSO₄",   name: "硫酸バリウム（沈殿）", atoms: { Ba: 1, S: 1, O: 4 }, charge: 0 },
  "NaHSO4":  { disp: "NaHSO₄",  name: "硫酸水素ナトリウム（酸性塩）", atoms: { Na: 1, H: 1, S: 1, O: 4 }, charge: 0 },
  "NaHCO3":  { disp: "NaHCO₃",  name: "炭酸水素ナトリウム（酸性塩）", atoms: { Na: 1, H: 1, C: 1, O: 3 }, charge: 0 },
  // イオン
  "H+":      { disp: "H⁺",    name: "水素イオン",         atoms: { H: 1 },         charge: 1 },
  "OH-":     { disp: "OH⁻",   name: "水酸化物イオン",     atoms: { O: 1, H: 1 },   charge: -1 },
  "Na+":     { disp: "Na⁺",   name: "ナトリウムイオン",   atoms: { Na: 1 },        charge: 1 },
  "Cl-":     { disp: "Cl⁻",   name: "塩化物イオン",       atoms: { Cl: 1 },        charge: -1 },
  "SO4^2-":  { disp: "SO₄²⁻", name: "硫酸イオン",         atoms: { S: 1, O: 4 },   charge: -2 },
  "Ca^2+":   { disp: "Ca²⁺",  name: "カルシウムイオン",   atoms: { Ca: 1 },        charge: 2 },
  "Ag+":     { disp: "Ag⁺",   name: "銀イオン",           atoms: { Ag: 1 },        charge: 1 },
  "NO3-":    { disp: "NO₃⁻",  name: "硝酸イオン",         atoms: { N: 1, O: 3 },   charge: -1 },
  "Ba^2+":   { disp: "Ba²⁺",  name: "バリウムイオン",     atoms: { Ba: 1 },        charge: 2 },
  "K+":      { disp: "K⁺",    name: "カリウムイオン",     atoms: { K: 1 },         charge: 1 },
  "SO3^2-":  { disp: "SO₃²⁻", name: "亜硫酸イオン",       atoms: { S: 1, O: 3 },   charge: -2 },
  "CO3^2-":  { disp: "CO₃²⁻", name: "炭酸イオン",         atoms: { C: 1, O: 3 },   charge: -2 },
  "HCO3-":   { disp: "HCO₃⁻", name: "炭酸水素イオン",     atoms: { H: 1, C: 1, O: 3 }, charge: -1 },
  // 酸化還元モード用
  "Mg":      { disp: "Mg",     name: "マグネシウム（原子）", atoms: { Mg: 1 },      charge: 0 },
  "Mg^2+":   { disp: "Mg²⁺",  name: "マグネシウムイオン", atoms: { Mg: 1 },        charge: 2 },
  "Fe":      { disp: "Fe",     name: "鉄（原子）",         atoms: { Fe: 1 },        charge: 0 },
  "Fe^2+":   { disp: "Fe²⁺",  name: "鉄(Ⅱ)イオン",       atoms: { Fe: 1 },        charge: 2 },
  "Al":      { disp: "Al",     name: "アルミニウム（原子）", atoms: { Al: 1 },      charge: 0 },
  "Al^3+":   { disp: "Al³⁺",  name: "アルミニウムイオン", atoms: { Al: 1 },        charge: 3 },
  "Zn":      { disp: "Zn",     name: "亜鉛（原子）",       atoms: { Zn: 1 },        charge: 0 },
  "Zn^2+":   { disp: "Zn²⁺",  name: "亜鉛イオン",         atoms: { Zn: 1 },        charge: 2 },
  "Cu":      { disp: "Cu",     name: "銅（原子）",         atoms: { Cu: 1 },        charge: 0 },
  "Cu^2+":   { disp: "Cu²⁺",  name: "銅(Ⅱ)イオン",       atoms: { Cu: 1 },        charge: 2 },
  "Ag":      { disp: "Ag",     name: "銀（原子）",         atoms: { Ag: 1 },        charge: 0 },
  "H2":      { disp: "H₂",    name: "水素",               atoms: { H: 2 },         charge: 0 },
  "e-":      { disp: "e⁻",    name: "電子",               atoms: {},               charge: -1 },
  // 溶液中の酸化還元（KMnO₄・K₂Cr₂O₇ 系。参照エントリ用。房・アニメは未実装）
  "KMnO4":     { disp: "KMnO₄",      name: "過マンガン酸カリウム", atoms: { K: 1, Mn: 1, O: 4 }, charge: 0 },
  "MnO4-":     { disp: "MnO₄⁻",      name: "過マンガン酸イオン（赤紫）", atoms: { Mn: 1, O: 4 }, charge: -1 },
  "Mn^2+":     { disp: "Mn²⁺",       name: "マンガン(Ⅱ)イオン（ほぼ無色）", atoms: { Mn: 1 }, charge: 2 },
  "MnSO4":     { disp: "MnSO₄",      name: "硫酸マンガン(Ⅱ)",     atoms: { Mn: 1, S: 1, O: 4 }, charge: 0 },
  "FeSO4":     { disp: "FeSO₄",      name: "硫酸鉄(Ⅱ)",           atoms: { Fe: 1, S: 1, O: 4 }, charge: 0 },
  "Fe^3+":     { disp: "Fe³⁺",       name: "鉄(Ⅲ)イオン",         atoms: { Fe: 1 }, charge: 3 },
  "Fe2(SO4)3": { disp: "Fe₂(SO₄)₃", name: "硫酸鉄(Ⅲ)",           atoms: { Fe: 2, S: 3, O: 12 }, charge: 0 },
  "K2SO4":     { disp: "K₂SO₄",      name: "硫酸カリウム",         atoms: { K: 2, S: 1, O: 4 }, charge: 0 },
  "K2Cr2O7":   { disp: "K₂Cr₂O₇",   name: "二クロム酸カリウム",   atoms: { K: 2, Cr: 2, O: 7 }, charge: 0 },
  "Cr2O7^2-":  { disp: "Cr₂O₇²⁻",   name: "二クロム酸イオン（橙）", atoms: { Cr: 2, O: 7 }, charge: -2 },
  "Cr^3+":     { disp: "Cr³⁺",       name: "クロム(Ⅲ)イオン（緑）", atoms: { Cr: 1 }, charge: 3 },
  "Cr2(SO4)3": { disp: "Cr₂(SO₄)₃", name: "硫酸クロム(Ⅲ)",       atoms: { Cr: 2, S: 3, O: 12 }, charge: 0 },
  "C2O4^2-":   { disp: "C₂O₄²⁻",    name: "シュウ酸イオン",       atoms: { C: 2, O: 4 }, charge: -2 },
  "H2C2O4":    { disp: "H₂C₂O₄",   name: "シュウ酸",             atoms: { H: 2, C: 2, O: 4 }, charge: 0 },
  // 錯イオン生成（参照エントリ用。アンミン錯体など）
  "NH3":         { disp: "NH₃",           name: "アンモニア",           atoms: { N: 1, H: 3 }, charge: 0 },
  "Cu(NH3)4SO4": { disp: "[Cu(NH₃)₄]SO₄", name: "テトラアンミン銅(Ⅱ)硫酸塩（深青）", atoms: { Cu: 1, N: 4, H: 12, S: 1, O: 4 }, charge: 0 },
  "Ag(NH3)2NO3": { disp: "[Ag(NH₃)₂]NO₃", name: "ジアンミン銀(Ⅰ)硝酸塩",           atoms: { Ag: 1, N: 3, H: 6, O: 3 }, charge: 0 },
  // 沈殿の再溶解・両性水酸化物（錯イオン生成の参照エントリ用）
  "Cu(NH3)4(OH)2": { disp: "[Cu(NH₃)₄](OH)₂", name: "テトラアンミン銅(Ⅱ)水酸化物（深青）", atoms: { Cu: 1, N: 4, H: 14, O: 2 }, charge: 0 },
  "Ag(NH3)2Cl":    { disp: "[Ag(NH₃)₂]Cl",   name: "ジアンミン銀(Ⅰ)塩化物",           atoms: { Ag: 1, N: 2, H: 6, Cl: 1 }, charge: 0 },
  "Al(OH)3":       { disp: "Al(OH)₃",         name: "水酸化アルミニウム（両性）",       atoms: { Al: 1, O: 3, H: 3 }, charge: 0 },
  "NaAl(OH)4":     { disp: "Na[Al(OH)₄]",     name: "テトラヒドロキシドアルミン酸ナトリウム", atoms: { Na: 1, Al: 1, O: 4, H: 4 }, charge: 0 },
  "Zn(OH)2":       { disp: "Zn(OH)₂",         name: "水酸化亜鉛（両性）",             atoms: { Zn: 1, O: 2, H: 2 }, charge: 0 },
  "Na2Zn(OH)4":    { disp: "Na₂[Zn(OH)₄]",   name: "テトラヒドロキシド亜鉛酸ナトリウム",   atoms: { Na: 2, Zn: 1, O: 4, H: 4 }, charge: 0 },
  // 錯イオン本体（配位子が結びついたイオン。ビーカー内で粒として描く）
  "Cu(NH3)4^2+":   { disp: "[Cu(NH₃)₄]²⁺",  name: "テトラアンミン銅(Ⅱ)イオン（深青）", atoms: { Cu: 1, N: 4, H: 12 }, charge: 2 },
  "Ag(NH3)2^+":    { disp: "[Ag(NH₃)₂]⁺",   name: "ジアンミン銀(Ⅰ)イオン",           atoms: { Ag: 1, N: 2, H: 6 }, charge: 1 },
  // 両性水酸化物が強塩基に溶けてできるヒドロキシド錯イオン
  "Al(OH)4^-":     { disp: "[Al(OH)₄]⁻",    name: "テトラヒドロキシドアルミン酸イオン", atoms: { Al: 1, O: 4, H: 4 }, charge: -1 },
  "Zn(OH)4^2-":    { disp: "[Zn(OH)₄]²⁻",   name: "テトラヒドロキシド亜鉛酸イオン",     atoms: { Zn: 1, O: 4, H: 4 }, charge: -2 },
  "AlCl3":         { disp: "AlCl₃",          name: "塩化アルミニウム",                 atoms: { Al: 1, Cl: 3 }, charge: 0 },
  "ZnSO4":         { disp: "ZnSO₄",          name: "硫酸亜鉛",                         atoms: { Zn: 1, S: 1, O: 4 }, charge: 0 },
  // 弱酸（部分電離）
  "CH3COOH":       { disp: "CH₃COOH",        name: "酢酸（弱酸）",                     atoms: { C: 2, H: 4, O: 2 }, charge: 0 },
  "CH3COO-":       { disp: "CH₃COO⁻",       name: "酢酸イオン",                       atoms: { C: 2, H: 3, O: 2 }, charge: -1 },
  "CH3COONa":      { disp: "CH₃COONa",       name: "酢酸ナトリウム",                   atoms: { C: 2, H: 3, O: 2, Na: 1 }, charge: 0 },
  // 弱塩基（アンモニア水）
  "NH4+":          { disp: "NH₄⁺",          name: "アンモニウムイオン",               atoms: { N: 1, H: 4 }, charge: 1 },
  "NH4Cl":         { disp: "NH₄Cl",          name: "塩化アンモニウム",                 atoms: { N: 1, H: 4, Cl: 1 }, charge: 0 },
  // C群（分子の組み換え）: 気体分子と、ばらけた原子
  "O2":            { disp: "O₂",             name: "酸素",                             atoms: { O: 2 }, charge: 0 },
  "CH4":           { disp: "CH₄",            name: "メタン",                           atoms: { C: 1, H: 4 }, charge: 0 },
  "H":             { disp: "H",              name: "水素原子",                         atoms: { H: 1 }, charge: 0 },
  "O":             { disp: "O",              name: "酸素原子",                         atoms: { O: 1 }, charge: 0 },
  "C":             { disp: "C",              name: "炭素原子",                         atoms: { C: 1 }, charge: 0 },
};

/* C群（分子の組み換え）の分解表。イオンではなく**原子**にばらける。
   燃焼・化合・分解では「原子は増えも減りもしない」ことが最も直接に見える。 */
const ATOMIZATION = {
  "H2":  ["H", "H"],
  "O2":  ["O", "O"],
  "CH4": ["C", "H", "H", "H", "H"],
};

/* 弱電解質（部分電離）。水に入れても**ほとんどが分子のまま**で、
   相手（OH⁻ など）に H⁺ を奪われると、残った分子がさらに電離して補う（ルシャトリエの原理）。
   ビーカーでは分子として溶かし、反応で必要になった時にこの表に従って電離させる。 */
const WEAK_ELECTROLYTES = {
  "CH3COOH": ["H+", "CH3COO-"],
};

/* 強電解質の電離表（v1 は完全電離のみ扱う） */
const DISSOCIATION = {
  "HCl":     ["H+", "Cl-"],
  "NaOH":    ["Na+", "OH-"],
  "H2SO4":   ["H+", "H+", "SO4^2-"],
  "Ca(OH)2": ["Ca^2+", "OH-", "OH-"],
  "NaCl":    ["Na+", "Cl-"],
  "Na2SO4":  ["Na+", "Na+", "SO4^2-"],
  "CaCl2":   ["Ca^2+", "Cl-", "Cl-"],
  "AgNO3":   ["Ag+", "NO3-"],
  "NaNO3":   ["Na+", "NO3-"],
  "BaCl2":   ["Ba^2+", "Cl-", "Cl-"],
  "HNO3":    ["H+", "NO3-"],
  "KOH":     ["K+", "OH-"],
  "KNO3":    ["K+", "NO3-"],
  "Ba(OH)2": ["Ba^2+", "OH-", "OH-"],
  "CuSO4":   ["Cu^2+", "SO4^2-"],
  "Na2SO3":  ["Na+", "Na+", "SO3^2-"],
  "Na2CO3":  ["Na+", "Na+", "CO3^2-"],
  // 溶液中の酸化還元 系（参照エントリの物質検索・分解表示用）
  "KMnO4":     ["K+", "MnO4-"],
  "FeSO4":     ["Fe^2+", "SO4^2-"],
  "MnSO4":     ["Mn^2+", "SO4^2-"],
  "K2SO4":     ["K+", "K+", "SO4^2-"],
  "Fe2(SO4)3": ["Fe^3+", "Fe^3+", "SO4^2-", "SO4^2-", "SO4^2-"],
  "K2Cr2O7":   ["K+", "K+", "Cr2O7^2-"],
  "Cr2(SO4)3": ["Cr^3+", "Cr^3+", "SO4^2-", "SO4^2-", "SO4^2-"],
  "H2C2O4":    ["H+", "H+", "C2O4^2-"],
  // 錯塩は「錯イオン＋対イオン」に電離する（錯イオンは水中でひとまとまりのまま）
  "Cu(NH3)4SO4": ["Cu(NH3)4^2+", "SO4^2-"],
  "Ag(NH3)2NO3": ["Ag(NH3)2^+", "NO3-"],
  "Cu(NH3)4(OH)2": ["Cu(NH3)4^2+", "OH-", "OH-"],
  // 両性水酸化物 系
  "AlCl3":      ["Al^3+", "Cl-", "Cl-", "Cl-"],
  "ZnSO4":      ["Zn^2+", "SO4^2-"],
  "NaAl(OH)4":  ["Na+", "Al(OH)4^-"],
  "Na2Zn(OH)4": ["Na+", "Na+", "Zn(OH)4^2-"],
  // 弱酸の塩は強電解質（完全電離する）
  "CH3COONa":   ["Na+", "CH3COO-"],
  // 弱塩基の塩も強電解質
  "NH4Cl":      ["NH4+", "Cl-"],
};

/* 数合わせビューで「式の項」を粒に分解する表。
   電離表に加え、電離しない生成物（H₂O・不溶性の沈殿）も
   「どのイオンが結びついたものか」として見せる（表示専用の分解。化学的な電離ではない）。 */
/* 電離表を土台に、個別指定で上書きする（同じ種は下の手書き定義が優先）。
   錯塩は電離では「錯イオン＋対イオン」だが、数合わせでは配位子まで開いて見せたいので上書きする。 */
const PARTS = Object.assign({}, DISSOCIATION, ATOMIZATION, {
  "H2O":   ["H+", "OH-"],
  "AgCl":  ["Ag+", "Cl-"],
  "BaSO4": ["Ba^2+", "SO4^2-"],
  "H2CO3": ["H+", "H+", "CO3^2-"],
  "CO2":   ["CO2"],  // イオンに分解できない分子はそれ自身（gasGroup 経由で H₂CO₃ として扱う）
  "Cu(OH)2": ["Cu^2+", "OH-", "OH-"],
  "H2SO3": ["H+", "H+", "SO3^2-"],
  "SO2":   ["SO2"],
  // 酸性塩は「中和で残った H⁺ が傍観アニオン・陽イオンと組んだ塩」として分解して見せる
  "NaHSO4": ["Na+", "H+", "SO4^2-"],
  "NaHCO3": ["Na+", "H+", "CO3^2-"],
  // 電離しない分子（配位子）はそれ自身
  "NH3":   ["NH3"],
  // 錯塩は「中心イオン＋配位子＋対イオン」まで開く（何個が組んだかを数えられるように）
  "Cu(NH3)4SO4": ["Cu^2+", "NH3", "NH3", "NH3", "NH3", "SO4^2-"],
  "Ag(NH3)2NO3": ["Ag+", "NH3", "NH3", "NO3-"],
  "Cu(NH3)4(OH)2": ["Cu^2+", "NH3", "NH3", "NH3", "NH3", "OH-", "OH-"],
  // 両性水酸化物が溶けてできる塩は「陽イオン＋中心イオン＋OH⁻」まで開く
  "NaAl(OH)4":  ["Na+", "Al^3+", "OH-", "OH-", "OH-", "OH-"],
  "Na2Zn(OH)4": ["Na+", "Na+", "Zn^2+", "OH-", "OH-", "OH-", "OH-"],
  // 弱酸は「電離しにくい」だけで、中和に使える H⁺ の総量は分子の数どおり（数合わせでは開いて見せる）
  "CH3COOH":    ["H+", "CH3COO-"],
  // 弱塩基の塩は「NH₃ が H⁺ を受け取って対イオンと組んだ姿」として開く
  "NH4Cl":      ["NH3", "H+", "Cl-"],
});

/* 数合わせビュー用の分解を、ステージごとに上書きできるようにする。
   同じ H₂O でも A群（水溶液）では H⁺＋OH⁻、C群（分子の組み換え）では H＋H＋O と見せたいため。 */
function partsOf(stage, sp) {
  return (stage && stage.parts && stage.parts[sp]) || PARTS[sp];
}

/* rules: ビーカー内の反応ルール（find の2イオンが出会うと make になる）。
   kind: "combine"=生成物が水中を浮遊 / "precipitate"=固体になり底に沈む。
   find は当面 1:1 の2種ペアのみ（DESIGN_reaction_types.md 参照）。 */
/* 房表示（原子クラスタ）の配置データ。座標は粒の中心からの相対値（見た目専用）。
   原子の内訳が SPECIES.atoms と一致することをテストで機械検証する。
   多原子イオンは env（包み円の半径）を持ち、電荷バッジは房全体に1つ付く。
   ここに無い種（単原子イオン等）は従来の1円表示。 */
const STRUCTURE = {
  // 多原子イオン
  "OH-":    { env: 17, atoms: [
    { el: "O", x: -3, y: 1, r: 9 }, { el: "H", x: 8, y: -6, r: 6 }] },
  "SO4^2-": { env: 24, atoms: [
    { el: "S", x: 0, y: 0, r: 9 },
    { el: "O", x: 0, y: -14, r: 7 }, { el: "O", x: 0, y: 14, r: 7 },
    { el: "O", x: -14, y: 0, r: 7 }, { el: "O", x: 14, y: 0, r: 7 }] },
  "NO3-":   { env: 22, atoms: [
    { el: "N", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -13, r: 7 }, { el: "O", x: 11, y: 7, r: 7 }, { el: "O", x: -11, y: 7, r: 7 }] },
  "CO3^2-": { env: 22, atoms: [
    { el: "C", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -13, r: 7 }, { el: "O", x: 11, y: 7, r: 7 }, { el: "O", x: -11, y: 7, r: 7 }] },
  // 分子（中性なので包みなし）
  "H2O":    { atoms: [
    { el: "O", x: 0, y: 2, r: 9 }, { el: "H", x: -10, y: -7, r: 6 }, { el: "H", x: 10, y: -7, r: 6 }] },
  "CO2":    { atoms: [
    { el: "O", x: -14, y: 0, r: 8 }, { el: "C", x: 0, y: 0, r: 8 }, { el: "O", x: 14, y: 0, r: 8 }] },
  "H2CO3":  { atoms: [
    { el: "C", x: 0, y: 3, r: 8 }, { el: "O", x: 0, y: -10, r: 7 },
    { el: "O", x: -11, y: 10, r: 7 }, { el: "O", x: 11, y: 10, r: 7 },
    { el: "H", x: -17, y: 14, r: 5 }, { el: "H", x: 17, y: 14, r: 5 }] },
  "H2":     { atoms: [
    { el: "H", x: -6, y: 0, r: 7 }, { el: "H", x: 6, y: 0, r: 7 }] },
  // アンモニア（配位子。電離せず分子のまま溶ける）
  "NH3":    { atoms: [
    { el: "N", x: 0, y: 1, r: 9 },
    { el: "H", x: -10, y: -7, r: 5.5 }, { el: "H", x: 10, y: -7, r: 5.5 }, { el: "H", x: 0, y: 12, r: 5.5 }] },
  // 酢酸（弱酸。右端の H が電離する H⁺）
  "CH3COOH": { atoms: [
    { el: "C", x: -13, y: 2, r: 8 },
    { el: "H", x: -22, y: -6, r: 5 }, { el: "H", x: -22, y: 10, r: 5 }, { el: "H", x: -13, y: 14, r: 5 },
    { el: "C", x: 5, y: 0, r: 8 },
    { el: "O", x: 5, y: -12, r: 7 }, { el: "O", x: 16, y: 7, r: 7 },
    { el: "H", x: 25, y: 13, r: 5 }] },
  // C群の気体分子
  "O2":     { atoms: [
    { el: "O", x: -8, y: 0, r: 9 }, { el: "O", x: 8, y: 0, r: 9 }] },
  "CH4":    { atoms: [
    { el: "C", x: 0, y: 0, r: 9 },
    { el: "H", x: -12, y: -10, r: 5.5 }, { el: "H", x: 12, y: -10, r: 5.5 },
    { el: "H", x: -12, y: 10, r: 5.5 }, { el: "H", x: 12, y: 10, r: 5.5 }] },
  // アンモニウムイオン（NH₃ が H⁺ を受け取った姿）
  "NH4+":   { env: 19, atoms: [
    { el: "N", x: 0, y: 0, r: 9 },
    { el: "H", x: -11, y: -8, r: 5.5 }, { el: "H", x: 11, y: -8, r: 5.5 },
    { el: "H", x: -11, y: 9, r: 5.5 }, { el: "H", x: 11, y: 9, r: 5.5 }] },
  "CH3COO-": { env: 26, atoms: [
    { el: "C", x: -13, y: 2, r: 8 },
    { el: "H", x: -22, y: -6, r: 5 }, { el: "H", x: -22, y: 10, r: 5 }, { el: "H", x: -13, y: 14, r: 5 },
    { el: "C", x: 5, y: 0, r: 8 },
    { el: "O", x: 5, y: -12, r: 7 }, { el: "O", x: 16, y: 7, r: 7 }] },
  "SO3^2-": { env: 22, atoms: [
    { el: "S", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -13, r: 7 }, { el: "O", x: 11, y: 7, r: 7 }, { el: "O", x: -11, y: 7, r: 7 }] },
  "H2SO3":  { atoms: [
    { el: "S", x: 0, y: 3, r: 8 }, { el: "O", x: 0, y: -10, r: 7 },
    { el: "O", x: -11, y: 10, r: 7 }, { el: "O", x: 11, y: 10, r: 7 },
    { el: "H", x: -17, y: 14, r: 5 }, { el: "H", x: 17, y: 14, r: 5 }] },
  "SO2":    { atoms: [
    { el: "O", x: -13, y: -3, r: 8 }, { el: "S", x: 0, y: 3, r: 8 }, { el: "O", x: 13, y: -3, r: 8 }] },
  // 沈殿（イオンがくっついて固まった姿）
  "AgCl":   { atoms: [
    { el: "Ag", x: -8, y: 0, r: 9 }, { el: "Cl", x: 8, y: 2, r: 9 }] },
  "Cu(OH)2": { atoms: [
    { el: "Cu", x: 0, y: 2, r: 9 },
    { el: "O", x: -13, y: -6, r: 7 }, { el: "H", x: -18, y: -11, r: 5 },
    { el: "O", x: 13, y: -6, r: 7 }, { el: "H", x: 18, y: -11, r: 5 }] },
  "BaSO4":  { atoms: [
    { el: "Ba", x: -13, y: -2, r: 9 }, { el: "S", x: 7, y: 2, r: 7 },
    { el: "O", x: 7, y: -10, r: 6 }, { el: "O", x: 7, y: 14, r: 6 },
    { el: "O", x: 17, y: 4, r: 6 }, { el: "O", x: -3, y: 8, r: 6 }] },
  "NaHSO4": { atoms: [
    { el: "Na", x: -18, y: 0, r: 9 }, { el: "S", x: 6, y: 2, r: 7 },
    { el: "O", x: 6, y: -10, r: 6.5 }, { el: "O", x: 6, y: 14, r: 6.5 },
    { el: "O", x: 16, y: 5, r: 6.5 }, { el: "O", x: -4, y: 5, r: 6.5 },
    { el: "H", x: 15, y: -10, r: 5 }] },
  // 炭酸水素イオン（多原子イオンなので包み env つき）
  "HCO3-":  { env: 22, atoms: [
    { el: "C", x: 0, y: 2, r: 8 },
    { el: "O", x: 0, y: -11, r: 7 }, { el: "O", x: 11, y: 9, r: 7 }, { el: "O", x: -11, y: 9, r: 7 },
    { el: "H", x: 9, y: -16, r: 5 }] },
  "NaHCO3": { atoms: [
    { el: "Na", x: -17, y: 0, r: 9 }, { el: "C", x: 6, y: 2, r: 7 },
    { el: "O", x: 6, y: -10, r: 6.5 }, { el: "O", x: 15, y: 8, r: 6.5 }, { el: "O", x: -3, y: 8, r: 6.5 },
    { el: "H", x: 14, y: -9, r: 5 }] },
  // 投入する分子（電離前の姿。落下中もこの形で見せる）
  "HCl":    { atoms: [
    { el: "H", x: -9, y: -3, r: 6 }, { el: "Cl", x: 5, y: 1, r: 10 }] },
  "NaOH":   { atoms: [
    { el: "Na", x: -9, y: 2, r: 9 }, { el: "O", x: 6, y: -2, r: 8 }, { el: "H", x: 15, y: -8, r: 5 }] },
  "H2SO4":  { atoms: [
    { el: "S", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -13, r: 7 }, { el: "O", x: 0, y: 13, r: 7 },
    { el: "O", x: -13, y: 0, r: 7 }, { el: "O", x: 13, y: 0, r: 7 },
    { el: "H", x: -22, y: 0, r: 5 }, { el: "H", x: 22, y: 0, r: 5 }] },
  "Ca(OH)2": { atoms: [
    { el: "Ca", x: 0, y: 2, r: 9 },
    { el: "O", x: -13, y: -6, r: 7 }, { el: "H", x: -18, y: -11, r: 5 },
    { el: "O", x: 13, y: -6, r: 7 }, { el: "H", x: 18, y: -11, r: 5 }] },
  "Na2CO3": { atoms: [
    { el: "Na", x: -17, y: -7, r: 8 }, { el: "Na", x: 17, y: -7, r: 8 },
    { el: "C", x: 0, y: 5, r: 7 }, { el: "O", x: 0, y: -7, r: 7 },
    { el: "O", x: -9, y: 12, r: 6.5 }, { el: "O", x: 9, y: 12, r: 6.5 }] },
  "AgNO3":  { atoms: [
    { el: "Ag", x: -13, y: 0, r: 9 }, { el: "N", x: 5, y: 0, r: 7 },
    { el: "O", x: 5, y: -11, r: 6.5 }, { el: "O", x: 14, y: 7, r: 6.5 }, { el: "O", x: -4, y: 8, r: 6.5 }] },
  "BaCl2":  { atoms: [
    { el: "Ba", x: 0, y: -2, r: 9 }, { el: "Cl", x: -14, y: 7, r: 8 }, { el: "Cl", x: 14, y: 7, r: 8 }] },
  "HNO3":   { atoms: [
    { el: "H", x: -19, y: 10, r: 5 }, { el: "N", x: 2, y: 0, r: 7 },
    { el: "O", x: 2, y: -12, r: 6.5 }, { el: "O", x: 12, y: 7, r: 6.5 }, { el: "O", x: -8, y: 7, r: 6.5 }] },
  "KOH":    { atoms: [
    { el: "K", x: -9, y: 2, r: 9 }, { el: "O", x: 6, y: -2, r: 8 }, { el: "H", x: 15, y: -8, r: 5 }] },
  "Ba(OH)2": { atoms: [
    { el: "Ba", x: 0, y: 2, r: 9 },
    { el: "O", x: -13, y: -6, r: 7 }, { el: "H", x: -18, y: -11, r: 5 },
    { el: "O", x: 13, y: -6, r: 7 }, { el: "H", x: 18, y: -11, r: 5 }] },
  "CuSO4":  { atoms: [
    { el: "Cu", x: -16, y: 0, r: 9 }, { el: "S", x: 6, y: 0, r: 7 },
    { el: "O", x: 6, y: -12, r: 6.5 }, { el: "O", x: 6, y: 12, r: 6.5 },
    { el: "O", x: 16, y: 4, r: 6.5 }, { el: "O", x: -4, y: -8, r: 6.5 }] },
  "Na2SO3": { atoms: [
    { el: "Na", x: -17, y: -7, r: 8 }, { el: "Na", x: 17, y: -7, r: 8 },
    { el: "S", x: 0, y: 5, r: 7 }, { el: "O", x: 0, y: -7, r: 7 },
    { el: "O", x: -9, y: 12, r: 6.5 }, { el: "O", x: 9, y: 12, r: 6.5 }] },
};

const STAGES = [
  {
    id: "s1",
    title: "ステージ1：塩酸 × 水酸化ナトリウム",
    reactants: ["HCl", "NaOH"],
    products: ["NaCl", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    netIon: "H⁺ ＋ OH⁻ → H₂O",
    intro: "HCl と NaOH を1個ずつ入れて、「反応させる」を押してみよう。",
    doneNote: "残ったイオンは反応しない「傍観イオン」で、水を蒸発させると塩（NaCl）として取り出せる。",
  },
  {
    id: "s2",
    title: "ステージ2：硫酸 × 水酸化ナトリウム",
    reactants: ["H2SO4", "NaOH"],
    products: ["Na2SO4", "H2O"],
    answer: [1, 2, 1, 2],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    netIon: "H⁺ ＋ OH⁻ → H₂O",
    intro: "H₂SO₄ は H⁺ を2個出す。ちょうど中和するには NaOH が何個必要だろう？",
    doneNote: "残ったイオンは傍観イオンで、水を蒸発させると塩（Na₂SO₄）として取り出せる。",
  },
  {
    id: "s3",
    title: "ステージ3：塩酸 × 水酸化カルシウム",
    reactants: ["HCl", "Ca(OH)2"],
    products: ["CaCl2", "H2O"],
    answer: [2, 1, 1, 2],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    netIon: "H⁺ ＋ OH⁻ → H₂O",
    intro: "Ca(OH)₂ は OH⁻ を2個出す。ちょうど中和するには HCl が何個必要だろう？",
    doneNote: "残ったイオンは傍観イオンで、水を蒸発させると塩（CaCl₂）として取り出せる。",
  },
  {
    id: "s4",
    title: "ステージ4：硝酸銀 × 塩化ナトリウム（沈殿）",
    reactants: ["AgNO3", "NaCl"],
    products: ["AgCl", "NaNO3"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["Ag+", "Cl-"], make: "AgCl", kind: "precipitate" }],
    netIon: "Ag⁺ ＋ Cl⁻ → AgCl↓",
    intro: "AgNO₃ と NaCl を入れて反応させてみよう。今度は水ではなく、白い沈殿ができる。",
    doneNote: "AgCl は水に溶けないので沈殿として底に積もる。Na⁺ と NO₃⁻ は溶けたまま（傍観イオン）。",
  },
  {
    id: "s5",
    title: "ステージ5：塩化バリウム × 硫酸ナトリウム（沈殿）",
    reactants: ["BaCl2", "Na2SO4"],
    products: ["BaSO4", "NaCl"],
    answer: [1, 1, 1, 2],
    rules: [{ find: ["Ba^2+", "SO4^2-"], make: "BaSO4", kind: "precipitate" }],
    netIon: "Ba²⁺ ＋ SO₄²⁻ → BaSO₄↓",
    intro: "白い沈殿 BaSO₄ ができる。沈殿にならないイオンが何個残るかに注目しよう。",
    doneNote: "BaSO₄ は水に溶けず沈殿する。Na⁺ と Cl⁻ は溶けたまま（傍観イオン。蒸発させると NaCl）。",
  },
  {
    id: "s6",
    title: "ステージ6：炭酸ナトリウム × 塩酸（気体発生）",
    reactants: ["Na2CO3", "HCl"],
    products: ["NaCl", "H2O", "CO2"],
    answer: [1, 2, 2, 1, 1],
    rules: [{ find: ["H+", "H+", "CO3^2-"], via: "H2CO3", make: ["H2O", "CO2"], kind: "gas" }],
    // 数合わせビューでは H₂O と CO₂ を「H₂CO₃ が分かれてできる組」として1列にまとめる
    gasGroup: { terms: ["H2O", "CO2"], via: "H2CO3" },
    netIon: "2H⁺ ＋ CO₃²⁻ → H₂O ＋ CO₂↑",
    intro: "Na₂CO₃ に塩酸を注ぐとシュワッと泡が出る。泡の正体を確かめよう。H⁺ は何個必要？",
    doneNote: "H⁺2個と CO₃²⁻ が組んで H₂CO₃（炭酸）になり、不安定なのですぐ H₂O と CO₂ に分かれる。CO₂ は泡になって空気中へ逃げる。",
  },
  {
    id: "s7",
    title: "ステージ7：硝酸 × 水酸化カリウム",
    reactants: ["HNO3", "KOH"],
    products: ["KNO3", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    netIon: "H⁺ ＋ OH⁻ → H₂O",
    intro: "酸と塩基が変わっても、中和の本質は同じだろうか？ 傍観イオンの顔ぶれに注目。",
    doneNote: "K⁺ と NO₃⁻ は傍観イオン。酸と塩基が変わっても、中和の本質は H⁺＋OH⁻→H₂O のまま。",
  },
  {
    id: "s8",
    title: "ステージ8：硫酸 × 水酸化バリウム（中和＋沈殿）",
    reactants: ["H2SO4", "Ba(OH)2"],
    products: ["BaSO4", "H2O"],
    answer: [1, 1, 1, 2],
    rules: [
      { find: ["H+", "OH-"], make: "H2O", kind: "combine" },
      { find: ["Ba^2+", "SO4^2-"], make: "BaSO4", kind: "precipitate" },
    ],
    netIon: "H⁺＋OH⁻→H₂O と Ba²⁺＋SO₄²⁻→BaSO₄↓ が同時に起こる",
    intro: "この反応では2つの組み変わりが同時に起こる。反応のあと、水に残るイオンはあるだろうか？",
    doneNote: "中和と沈殿が同時に起こり、傍観イオンが1つも残らない珍しい反応。溶液はほぼ純水になる。",
  },
  {
    id: "s9",
    title: "ステージ9：硫酸銅 × 水酸化ナトリウム（青白色の沈殿）",
    reactants: ["CuSO4", "NaOH"],
    products: ["Cu(OH)2", "Na2SO4"],
    answer: [1, 2, 1, 1],
    rules: [{ find: ["Cu^2+", "OH-", "OH-"], make: "Cu(OH)2", kind: "precipitate" }],
    netIon: "Cu²⁺ ＋ 2OH⁻ → Cu(OH)₂↓（青白色）",
    intro: "青い水溶液に塩基を加えると、青白色の沈殿ができる。Cu²⁺ は OH⁻ を何個つかまえる？",
    doneNote: "Cu²⁺ 1個が OH⁻ 2個と組んで Cu(OH)₂ の沈殿になる。沈殿の色は無機化学の重要な手がかり。",
  },
  {
    id: "s10",
    title: "ステージ10：亜硫酸ナトリウム × 塩酸（気体発生）",
    reactants: ["Na2SO3", "HCl"],
    products: ["NaCl", "H2O", "SO2"],
    answer: [1, 2, 2, 1, 1],
    rules: [{ find: ["H+", "H+", "SO3^2-"], via: "H2SO3", make: ["H2O", "SO2"], kind: "gas" }],
    gasGroup: { terms: ["H2O", "SO2"], via: "H2SO3" },
    netIon: "2H⁺ ＋ SO₃²⁻ → H₂O ＋ SO₂↑",
    intro: "炭酸塩のときと同じパターンが使えるだろうか？ 今度の泡は刺激臭のある SO₂。",
    doneNote: "H⁺2個と SO₃²⁻ が組んで H₂SO₃（亜硫酸）になり、すぐ H₂O と SO₂ に分かれる。弱酸の塩＋強酸→弱酸の遊離、の典型パターン。",
  },
  {
    id: "s11",
    title: "ステージ11：硫酸 × 水酸化ナトリウム（酸性塩をつくる）",
    reactants: ["H2SO4", "NaOH"],
    products: ["NaHSO4", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    // 目標＝酸性塩。中和で塩基(OH⁻)を使い切り、残ったイオンが目標の塩の組を構成すればクリア。
    // ions＝成功時にビーカーに残るイオンの多重集合（1組ぶん。この整数倍でクリア）。
    // 完全中和（1:2）だと正塩 Na₂SO₄ になってしまい、酸性塩にはならない。
    saltGoal: {
      label: "NaHSO4",
      ions: { "Na+": 1, "H+": 1, "SO4^2-": 1 },
      overNote: "塩基を入れすぎると完全に中和して正塩 Na₂SO₄ になる。NaHSO₄ には NaOH を H₂SO₄ と同数だけ（1:1）に。",
    },
    netIon: "H⁺ ＋ OH⁻ → H₂O（H₂SO₄ の H⁺ 2個のうち1個だけ中和される）",
    intro: "H₂SO₄ は H⁺ を2個持つ。NaOH を1個だけ入れて H⁺ を1個だけ中和すると、残りはどうなる？",
    doneNote: "H⁺ 1個だけが OH⁻ と中和し、残った H⁺ が SO₄²⁻・Na⁺ と組む。水溶液は酸性（酸性塩＝中和しきらず酸の H が残った塩）。",
  },
  {
    id: "s12",
    title: "ステージ12：炭酸ナトリウム × 塩酸（酸性塩をつくる）",
    reactants: ["Na2CO3", "HCl"],
    products: ["NaHCO3", "NaCl"],
    answer: [1, 1, 1, 1],
    // 部分プロトン化: CO₃²⁻ が H⁺ を1個だけ受け取って HCO₃⁻ に（泡は出ない）。
    rules: [{ find: ["H+", "CO3^2-"], make: "HCO3-", kind: "combine" }],
    saltGoal: {
      label: "NaHCO3",
      ions: { "Na+": 2, "HCO3-": 1, "Cl-": 1 },
      overNote: "比がずれると NaHCO₃ にならない。Na₂CO₃ と HCl を同数（1:1）に。酸が多いと HCO₃⁻ がもう1個 H⁺ を受け取り CO₂ になってしまう。",
    },
    netIon: "CO₃²⁻ ＋ H⁺ → HCO₃⁻（炭酸イオンが H⁺ を1個だけ受け取る）",
    intro: "Na₂CO₃ に塩酸を少しだけ加えると、泡は出ずにまず炭酸水素イオン HCO₃⁻ ができる。HCl は何個入れる？",
    doneNote: "CO₃²⁻ が H⁺ を1個だけ受け取って HCO₃⁻ になり、Na⁺ と組んで酸性塩 NaHCO₃ に（残る Na⁺ と Cl⁻ は NaCl）。さらに酸を加えると HCO₃⁻ がもう1個 H⁺ を受け取り CO₂ になる＝ステージ6の全体反応。",
  },
  {
    // id は reactions.json の反応 id と一致させる（インデックスからの ?rxn ディープリンク用）
    id: "complex-cu-nh3",
    title: "ステージ13：硫酸銅 × アンモニア（錯イオン）",
    reactants: ["CuSO4", "NH3"],
    products: ["Cu(NH3)4SO4"],
    answer: [1, 4, 1],
    // 配位: NH₃ は電離せず分子のまま Cu²⁺ を取り囲む（電子の移動はない）
    rules: [{ find: ["Cu^2+", "NH3", "NH3", "NH3", "NH3"], make: "Cu(NH3)4^2+", kind: "complex" }],
    netIon: "Cu²⁺ ＋ 4NH₃ → [Cu(NH₃)₄]²⁺（深青色）",
    intro: "青い硫酸銅水溶液にアンモニアを加えると、NH₃ が Cu²⁺ にくっついて濃い青色になる。NH₃ は何個必要？",
    doneNote: "NH₃ 4個が Cu²⁺ を取り囲んで [Cu(NH₃)₄]²⁺（テトラアンミン銅(Ⅱ)イオン）に。この結びつきを配位といい、できたイオンが錯イオン。SO₄²⁻ は傍観イオン。",
  },
  {
    id: "complex-ag-nh3",
    title: "ステージ14：硝酸銀 × アンモニア（錯イオン）",
    reactants: ["AgNO3", "NH3"],
    products: ["Ag(NH3)2NO3"],
    answer: [1, 2, 1],
    rules: [{ find: ["Ag+", "NH3", "NH3"], make: "Ag(NH3)2^+", kind: "complex" }],
    netIon: "Ag⁺ ＋ 2NH₃ → [Ag(NH₃)₂]⁺",
    intro: "銀イオンにアンモニアを加えると錯イオンができる。Cu²⁺ は4個だったが、Ag⁺ は何個の NH₃ とくっつく？",
    doneNote: "Ag⁺ は NH₃ を2個つかまえて [Ag(NH₃)₂]⁺（ジアンミン銀(Ⅰ)イオン）になる。中心のイオンによって配位する数（配位数）が違う。これは銀鏡反応に使うアンモニア性硝酸銀の正体。",
  },
  {
    id: "complex-cuoh2-nh3",
    title: "ステージ15：硫酸銅 × 水酸化ナトリウム × アンモニア（沈殿の再溶解）",
    reactants: ["CuSO4", "NaOH", "NH3"],
    products: ["Cu(NH3)4(OH)2", "Na2SO4"],
    answer: [1, 2, 4, 1, 1],
    // 二段変化: まず青白い沈殿ができ、続けて NH₃ がその沈殿を溶かして錯イオンにする。
    // 2番目のルールは沈殿（settled）を材料に取る（app.js の isReactive が settled を含む）。
    rules: [
      { find: ["Cu^2+", "OH-", "OH-"], make: "Cu(OH)2", kind: "precipitate" },
      { find: ["Cu(OH)2", "NH3", "NH3", "NH3", "NH3"], make: ["Cu(NH3)4^2+", "OH-", "OH-"], kind: "complex" },
    ],
    // 途中でできる沈殿。残っていれば「まだ溶けていない」と判定する
    intermediates: ["Cu(OH)2"],
    netIon: "Cu²⁺＋2OH⁻→Cu(OH)₂↓ ののち Cu(OH)₂＋4NH₃→[Cu(NH₃)₄]²⁺＋2OH⁻（沈殿が溶ける）",
    intro: "まず NaOH で青白い沈殿 Cu(OH)₂ をつくり、そこへアンモニアを加えると沈殿が溶ける。NaOH と NH₃ は何個ずつ？",
    doneNote: "沈殿 Cu(OH)₂ に NH₃ が4個配位すると [Cu(NH₃)₄]²⁺ になって溶け、深青色の溶液になる。放出された OH⁻ は溶液に戻る。「沈殿ができる→過剰の試薬で溶ける」は無機化学の重要パターン。",
  },
  {
    id: "amphoteric-aloh3-naoh",
    title: "ステージ16：塩化アルミニウム × 水酸化ナトリウム（両性）",
    reactants: ["AlCl3", "NaOH"],
    products: ["NaAl(OH)4", "NaCl"],
    answer: [1, 4, 1, 3],
    // 同じ NaOH が「少量なら沈殿・過剰なら再溶解」を起こすのが両性水酸化物
    rules: [
      { find: ["Al^3+", "OH-", "OH-", "OH-"], make: "Al(OH)3", kind: "precipitate" },
      { find: ["Al(OH)3", "OH-"], make: "Al(OH)4^-", kind: "complex" },
    ],
    intermediates: ["Al(OH)3"],
    netIon: "Al³⁺＋3OH⁻→Al(OH)₃↓ ののち Al(OH)₃＋OH⁻→[Al(OH)₄]⁻（過剰の塩基で溶ける）",
    intro: "Al³⁺ に NaOH を3個入れると白い沈殿ができる。さらに入れるとどうなる？ 全部で何個必要？",
    doneNote: "Al(OH)₃ は両性水酸化物。OH⁻ を3個で沈殿になり、さらに1個受け取ると [Al(OH)₄]⁻ になって溶ける（合計4個）。同じ試薬でも量で結果が変わる典型例。酸にも溶ける。",
  },
  {
    id: "amphoteric-znoh2-naoh",
    title: "ステージ17：硫酸亜鉛 × 水酸化ナトリウム（両性）",
    reactants: ["ZnSO4", "NaOH"],
    products: ["Na2Zn(OH)4", "Na2SO4"],
    answer: [1, 4, 1, 1],
    rules: [
      { find: ["Zn^2+", "OH-", "OH-"], make: "Zn(OH)2", kind: "precipitate" },
      { find: ["Zn(OH)2", "OH-", "OH-"], make: "Zn(OH)4^2-", kind: "complex" },
    ],
    intermediates: ["Zn(OH)2"],
    netIon: "Zn²⁺＋2OH⁻→Zn(OH)₂↓ ののち Zn(OH)₂＋2OH⁻→[Zn(OH)₄]²⁻（過剰の塩基で溶ける）",
    intro: "Zn²⁺ も両性。Al³⁺ のときは合計4個だった。Zn²⁺ では OH⁻ は何個必要だろう？",
    doneNote: "Zn(OH)₂ も両性水酸化物。OH⁻ を2個で沈殿になり、さらに2個受け取って [Zn(OH)₄]²⁻ として溶ける（合計4個）。Zn²⁺ はアンモニア水にも溶けて [Zn(NH₃)₄]²⁺ をつくる。",
  },
  {
    id: "weak-acid-ch3cooh-naoh",
    title: "ステージ18：酢酸 × 水酸化ナトリウム（弱酸）",
    reactants: ["CH3COOH", "NaOH"],
    products: ["CH3COONa", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    // 分子のまま残っている酢酸は「まだ中和されていない」ぶん
    intermediates: ["CH3COOH"],
    netIon: "CH₃COOH ＋ OH⁻ → CH₃COO⁻ ＋ H₂O（弱酸は分子のまま反応する）",
    intro: "酢酸は弱酸で、水に入れてもほとんどが分子のまま（少ししか電離しない）。それでもちょうど中和するには NaOH は何個必要？",
    doneNote: "電離していた H⁺ が中和されると、残った分子がさらに電離して H⁺ を補う（ルシャトリエの原理）。だから弱酸でも最後には全部が中和される。必要な NaOH の数は「酸の総量」で決まり、電離のしやすさ（電離度）には関係しない — ここが弱酸の大事なところ。",
  },
  {
    id: "weak-base-nh3-hcl",
    title: "ステージ19：アンモニア × 塩酸（弱塩基）",
    reactants: ["NH3", "HCl"],
    products: ["NH4Cl"],
    answer: [1, 1, 1],
    // 弱塩基は OH⁻ を出すのではなく、H⁺ を受け取る（ブレンステッドの定義）
    rules: [{ find: ["NH3", "H+"], make: "NH4+", kind: "combine" }],
    intermediates: ["NH3"],
    netIon: "NH₃ ＋ H⁺ → NH₄⁺（弱塩基は H⁺ を受け取る）",
    intro: "アンモニアは弱塩基。NaOH のように OH⁻ を出すのではなく、酸の H⁺ を受け取って働く。塩酸とはどんな比で反応する？",
    doneNote: "NH₃ は分子のまま溶け、H⁺ を1個受け取って NH₄⁺ になる（塩基＝H⁺ の受け取り手、というブレンステッドの考え方）。残った Cl⁻ と組んで塩化アンモニウム NH₄Cl ができる。アンモニア水が塩基性なのも、水から H⁺ を奪って OH⁻ を残すため。",
  },
  {
    id: "combustion-h2-o2",
    title: "ステージ20：水素の燃焼（分子の組み換え）",
    phase: "gas",   // 水溶液ではなく気体の空間
    reactants: ["H2", "O2"],
    products: ["H2O"],
    answer: [2, 1, 2],
    // イオンではなく原子にばらけて、組み替わる
    rules: [{ find: ["H", "H", "O"], make: "H2O", kind: "combine" }],
    parts: { "H2O": ["H", "H", "O"] },   // この群では水を「H・H・O」として見せる
    netIon: "2H₂ ＋ O₂ → 2H₂O（原子の組み替え。イオンは出ない）",
    intro: "ここは水の中ではなく気体の空間。水素と酸素が原子にばらけて組み替わる。H₂ と O₂ は何個ずつ？",
    doneNote: "分子がいったん原子にばらけ、H2個とO1個が組んで H₂O になる。原子は増えも減りもせず、組み合わせが変わるだけ — これが化学変化の本質で、反応式の係数はその個数合わせ。",
  },
  {
    id: "combustion-ch4-o2",
    title: "ステージ21：メタンの燃焼（分子の組み換え）",
    phase: "gas",
    reactants: ["CH4", "O2"],
    products: ["CO2", "H2O"],
    answer: [1, 2, 1, 2],
    rules: [
      { find: ["C", "O", "O"], make: "CO2", kind: "combine" },
      { find: ["H", "H", "O"], make: "H2O", kind: "combine" },
    ],
    parts: { "H2O": ["H", "H", "O"], "CO2": ["C", "O", "O"] },
    netIon: "CH₄ ＋ 2O₂ → CO₂ ＋ 2H₂O（都市ガスが燃えるときの反応）",
    intro: "メタン（都市ガス）が燃えると二酸化炭素と水ができる。C・H・O の数がぴったり合うように O₂ を何個入れる？",
    doneNote: "CH₄ の C は CO₂ に、H は H₂O になる。必要な O は CO₂ に2個・H₂O 2個に2個で計4個＝O₂ 2個ぶん。炭素を含む物質が燃えると必ず CO₂ と H₂O ができる、が燃焼の基本形。",
  },
];

/* 単元タグ（塩の分類・反応の型）。アプリを教科の枠に内包させず、ステージ横断の
   単元づけをここで行う（DEVELOPMENT.md 方針）。反応の型と塩の分類を併記する。 */
const STAGE_TAGS = {
  s1:  ["中和", "正塩"],
  s2:  ["中和", "正塩"],
  s3:  ["中和", "正塩"],
  s4:  ["沈殿", "正塩"],
  s5:  ["沈殿", "正塩"],
  s6:  ["気体発生", "正塩"],
  s7:  ["中和", "正塩"],
  s8:  ["中和", "沈殿", "正塩"],
  s9:  ["沈殿", "正塩"],
  s10: ["気体発生", "正塩"],
  s11: ["中和", "酸性塩"],
  s12: ["中和", "酸性塩"],
  "complex-cu-nh3": ["錯イオン", "配位"],
  "complex-ag-nh3": ["錯イオン", "配位"],
  "complex-cuoh2-nh3": ["錯イオン", "沈殿の再溶解", "沈殿"],
  "amphoteric-aloh3-naoh": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "amphoteric-znoh2-naoh": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "weak-acid-ch3cooh-naoh": ["中和", "弱酸", "電離平衡", "正塩"],
  "weak-base-nh3-hcl": ["中和", "弱塩基", "正塩"],
  "combustion-h2-o2": ["分子反応", "燃焼", "原子の保存"],
  "combustion-ch4-o2": ["分子反応", "燃焼", "原子の保存"],
};

/* 表示時の元素の並び順（金属 → H → その他） */
const ELEMENT_ORDER = ["Na", "Ca", "Ag", "Ba", "Zn", "Cu", "H", "C", "N", "S", "O", "Cl"];

/* ---- 酸化還元モード（DESIGN_redox.md）---- */

/* 半反応式（部品）。left/right は e⁻ を含む項の一覧。原子・電荷保存はテストで検証 */
const HALF_REACTIONS = {
  "Zn_ox":  { disp: "Zn → Zn²⁺ ＋ 2e⁻", kind: "oxidation",
              left: [{ sp: "Zn", n: 1 }], right: [{ sp: "Zn^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Cu_ox":  { disp: "Cu → Cu²⁺ ＋ 2e⁻", kind: "oxidation",
              left: [{ sp: "Cu", n: 1 }], right: [{ sp: "Cu^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Cu_red": { disp: "Cu²⁺ ＋ 2e⁻ → Cu", kind: "reduction",
              left: [{ sp: "Cu^2+", n: 1 }, { sp: "e-", n: 2 }], right: [{ sp: "Cu", n: 1 }] },
  "Ag_red": { disp: "Ag⁺ ＋ e⁻ → Ag", kind: "reduction",
              left: [{ sp: "Ag+", n: 1 }, { sp: "e-", n: 1 }], right: [{ sp: "Ag", n: 1 }] },
  "H_red":  { disp: "2H⁺ ＋ 2e⁻ → H₂", kind: "reduction",
              left: [{ sp: "H+", n: 2 }, { sp: "e-", n: 2 }], right: [{ sp: "H2", n: 1 }] },
  "Mg_ox":  { disp: "Mg → Mg²⁺ ＋ 2e⁻", kind: "oxidation",
              left: [{ sp: "Mg", n: 1 }], right: [{ sp: "Mg^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Fe_ox":  { disp: "Fe → Fe²⁺ ＋ 2e⁻", kind: "oxidation",
              left: [{ sp: "Fe", n: 1 }], right: [{ sp: "Fe^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Al_ox":  { disp: "Al → Al³⁺ ＋ 3e⁻", kind: "oxidation",
              left: [{ sp: "Al", n: 1 }], right: [{ sp: "Al^3+", n: 1 }, { sp: "e-", n: 3 }] },
  // 溶液中の酸化還元（DESIGN_redox.md「溶液中の酸化還元」。酸化剤側に H⁺・H₂O が入る）
  "MnO4_red":  { disp: "MnO₄⁻ ＋ 8H⁺ ＋ 5e⁻ → Mn²⁺ ＋ 4H₂O", kind: "reduction",
                 left: [{ sp: "MnO4-", n: 1 }, { sp: "H+", n: 8 }, { sp: "e-", n: 5 }],
                 right: [{ sp: "Mn^2+", n: 1 }, { sp: "H2O", n: 4 }] },
  "Cr2O7_red": { disp: "Cr₂O₇²⁻ ＋ 14H⁺ ＋ 6e⁻ → 2Cr³⁺ ＋ 7H₂O", kind: "reduction",
                 left: [{ sp: "Cr2O7^2-", n: 1 }, { sp: "H+", n: 14 }, { sp: "e-", n: 6 }],
                 right: [{ sp: "Cr^3+", n: 2 }, { sp: "H2O", n: 7 }] },
  "Fe2_ox":    { disp: "Fe²⁺ → Fe³⁺ ＋ e⁻", kind: "oxidation",
                 left: [{ sp: "Fe^2+", n: 1 }], right: [{ sp: "Fe^3+", n: 1 }, { sp: "e-", n: 1 }] },
  "oxalate_ox": { disp: "C₂O₄²⁻ → 2CO₂ ＋ 2e⁻", kind: "oxidation",
                 left: [{ sp: "C2O4^2-", n: 1 }], right: [{ sp: "CO2", n: 2 }, { sp: "e-", n: 2 }] },
};

/* 半反応式の e⁻ の数（酸化なら出す数、還元なら受け取る数） */
function electronsOf(hr) {
  const all = [...hr.left, ...hr.right];
  return all.filter((t) => t.sp === "e-").reduce((s, t) => s + t.n, 0);
}

/* 酸化数（種→元素→値）。「原子の酸化数の合計＝種の電荷」をテストで機械検証する */
const OXIDATION = {
  "Zn":    { Zn: 0 },
  "Zn^2+": { Zn: 2 },
  "Cu":    { Cu: 0 },
  "Cu^2+": { Cu: 2 },
  "Ag":    { Ag: 0 },
  "Ag+":   { Ag: 1 },
  "H+":    { H: 1 },
  "H2":    { H: 0 },
  "Mg":    { Mg: 0 },
  "Mg^2+": { Mg: 2 },
  "Fe":    { Fe: 0 },
  "Fe^2+": { Fe: 2 },
  "Al":    { Al: 0 },
  "Al^3+": { Al: 3 },
  // 溶液中の酸化還元（多原子イオンは O=−2・H=+1 基準の値を直接保持。過酸化物など例外もデータで表現）
  "MnO4-":    { Mn: 7, O: -2 },
  "Mn^2+":    { Mn: 2 },
  "Cr2O7^2-": { Cr: 6, O: -2 },
  "Cr^3+":    { Cr: 3 },
  "Fe^3+":    { Fe: 3 },
  "H2O":      { H: 1, O: -2 },
  "C2O4^2-":  { C: 3, O: -2 },
  "CO2":      { C: 4, O: -2 },
};

/* 半反応式の中で酸化数が変化する元素と前後の値を返す。
   表示は「変化する原子だけ」なので、この結果が表示対象の正になる */
function oxChangeOfHalf(hr) {
  const val = (terms) => {
    const m = {};
    for (const t of terms) {
      if (t.sp === "e-") continue;
      const ox = OXIDATION[t.sp];
      if (!ox) continue;
      for (const el of Object.keys(ox)) m[el] = ox[el];
    }
    return m;
  };
  const L = val(hr.left), R = val(hr.right);
  const changes = [];
  for (const el of Object.keys(L)) {
    if (el in R && L[el] !== R[el]) changes.push({ el, from: L[el], to: R[el] });
  }
  return changes;
}

/* 有色の化学種の色（溶液中の酸化還元アニメの色変化用。見た目専用だが検証はする）。
   ここに無い種は無色（既定の淡色）として扱う。 */
const SPECIES_COLOR = {
  "MnO4-":    "#7b2fb0", // 赤紫（過マンガン酸）
  "Mn^2+":    "#f0e6f3", // ほぼ無色（淡い）
  "Cr2O7^2-": "#e0842a", // 橙（二クロム酸）
  "Cr^3+":    "#3f9d5a", // 緑
  "Fe^2+":    "#a9d3a9", // 淡緑
  "Fe^3+":    "#c79a3a", // 黄褐
};

const REDOX_STAGES = [
  {
    id: "r1", title: "ステージ1：亜鉛 × 銅(Ⅱ)イオン",
    ox: "Zn_ox", red: "Cu_red", answer: [1, 1],
    intro: "硫酸銅水溶液に亜鉛板を入れると、板に赤い銅が付き、亜鉛が溶けていく。電子の動きを見よう。",
  },
  {
    id: "r2", title: "ステージ2：銅 × 銀イオン（銀樹）",
    ox: "Cu_ox", red: "Ag_red", answer: [1, 2],
    intro: "硝酸銀水溶液に銅線を入れると銀樹が育つ。Cu は e⁻ を2個出すが、Ag⁺ は1個ずつしか受け取れない。",
  },
  {
    id: "r3", title: "ステージ3：亜鉛 × 塩酸（水素発生）",
    ox: "Zn_ox", red: "H_red", answer: [1, 1],
    intro: "亜鉛に塩酸を注ぐと H₂ の泡が出る。e⁻ を受け取るのは H⁺ が2個で1組。",
  },
  {
    id: "r4", title: "ステージ4：アルミニウム × 銅(Ⅱ)イオン（2:3）",
    ox: "Al_ox", red: "Cu_red", answer: [2, 3],
    intro: "Al は e⁻ を3個出し、Cu²⁺ は2個ずつ受け取る。3と2の最小公倍数、e⁻ 6個でそろえよう。",
  },
  {
    id: "rs1", title: "ステージ5：過マンガン酸カリウム × 鉄(Ⅱ)（溶液中）",
    ox: "Fe2_ox", red: "MnO4_red", answer: [5, 1], mode: "solution",
    intro: "板は無し。溶液中で Fe²⁺ が e⁻ を出して Fe³⁺ に、MnO₄⁻ が H⁺ と e⁻ を受け取って Mn²⁺ になる。赤紫が消えるまで。",
  },
  {
    id: "rs2", title: "ステージ6：二クロム酸カリウム × 鉄(Ⅱ)（溶液中）",
    ox: "Fe2_ox", red: "Cr2O7_red", answer: [6, 1], mode: "solution",
    intro: "Cr₂O₇²⁻ は Cr が2個で e⁻ を6個受け取る。Fe²⁺ を何個そろえる？ 橙色が緑色に変わる。",
  },
  {
    id: "rs3", title: "ステージ7：過マンガン酸カリウム × シュウ酸（溶液中）",
    ox: "oxalate_ox", red: "MnO4_red", answer: [5, 2], mode: "solution",
    intro: "シュウ酸 C₂O₄²⁻ は e⁻ を2個出して CO₂ の泡になる。MnO₄⁻ は5個受け取る。e⁻ 10個でそろえよう。紫が消え、泡が出る。",
  },
];

/* 倍率 a（酸化側）・b（還元側）の判定: e⁻ の授受が等しく、最簡整数比であること */
function checkRedoxMultipliers(stage, a, b) {
  if (![a, b].every((v) => Number.isInteger(v) && v >= 1)) {
    return { ok: false, reason: "倍率は1以上の整数で" };
  }
  const give = electronsOf(HALF_REACTIONS[stage.ox]) * a;
  const take = electronsOf(HALF_REACTIONS[stage.red]) * b;
  if (give !== take) {
    return { ok: false, reason: `出す e⁻（${give}個）と受け取る e⁻（${take}個）が合っていない`, give, take };
  }
  if (gcd2(a, b) !== 1) {
    return { ok: false, reason: "e⁻ は合っているが、倍率は最も簡単な整数比にしよう", give, take };
  }
  return { ok: true, give, take };
}

/* 半反応式×倍率を足し合わせ、両辺に現れる種（e⁻）を打ち消したイオン反応式を返す */
function combineHalves(stage, a, b) {
  const ox = HALF_REACTIONS[stage.ox], red = HALF_REACTIONS[stage.red];
  const L = {}, R = {};
  const add = (map, terms, k) => { for (const t of terms) map[t.sp] = (map[t.sp] || 0) + t.n * k; };
  add(L, ox.left, a); add(L, red.left, b);
  add(R, ox.right, a); add(R, red.right, b);
  for (const sp of Object.keys(L)) {
    if (R[sp]) {
      const c = Math.min(L[sp], R[sp]);
      L[sp] -= c; R[sp] -= c;
    }
  }
  const toTerms = (m) => Object.entries(m).filter(([, n]) => n > 0).map(([sp, n]) => ({ sp, n }));
  return { left: toTerms(L), right: toTerms(R) };
}

/* terms: [{sp, n}] → { atoms: {元素: 個数}, charge } */
function tallyTerms(terms) {
  const atoms = {};
  let charge = 0;
  for (const t of terms) {
    const sp = SPECIES[t.sp];
    for (const el of Object.keys(sp.atoms)) {
      atoms[el] = (atoms[el] || 0) + sp.atoms[el] * t.n;
    }
    charge += sp.charge * t.n;
  }
  return { atoms, charge };
}

/* 左辺・右辺の原子数と電荷を突き合わせる */
function compareSides(left, right) {
  const L = tallyTerms(left), R = tallyTerms(right);
  const els = [...new Set([...Object.keys(L.atoms), ...Object.keys(R.atoms)])];
  const idx = (el) => {
    const i = ELEMENT_ORDER.indexOf(el);
    return i === -1 ? 99 : i;
  };
  els.sort((a, b) => idx(a) - idx(b) || a.localeCompare(b));
  const rows = els.map((el) => ({
    el,
    left: L.atoms[el] || 0,
    right: R.atoms[el] || 0,
    ok: (L.atoms[el] || 0) === (R.atoms[el] || 0),
  }));
  const chargeOk = L.charge === R.charge;
  return {
    rows,
    chargeLeft: L.charge,
    chargeRight: R.charge,
    chargeOk,
    balanced: rows.every((r) => r.ok) && chargeOk,
  };
}

function gcd2(a, b) {
  while (b) { const t = a % b; a = b; b = t; }
  return a;
}

function gcdAll(nums) {
  return nums.reduce((a, b) => gcd2(a, b));
}

/* 左辺の係数だけを与えて「何が何個できるか」を計算する。
   イオンのプールから products の並び順に生成物を最大数つくり、残りを余りとして返す
   （現ステージでは生成物同士が同じイオンを奪い合わないため順序は結果に影響しない。
   競合する反応を扱うときはここを見直すこと）。 */
function simulateFormation(stage, leftCoeffs) {
  const pool = {};
  stage.reactants.forEach((sp, i) => {
    // PARTS は電離表・原子化表を含み、電離しない分子（NH₃ など）はそれ自身に分解される
    for (const ion of partsOf(stage, sp)) pool[ion] = (pool[ion] || 0) + (leftCoeffs[i] || 0);
  });
  // gasGroup がある場合、該当2項（H₂O と CO₂ など）は中間体1項に置き換えて計算し、
  // 結果を両項へ同数として展開する
  let prods = stage.products.slice();
  if (stage.gasGroup) {
    prods = prods.filter((sp) => !stage.gasGroup.terms.includes(sp));
    prods.push(stage.gasGroup.via);
  }
  const formed = {};
  for (const prod of prods) {
    const need = {};
    for (const ion of partsOf(stage, prod)) need[ion] = (need[ion] || 0) + 1;
    let n = Infinity;
    for (const ion of Object.keys(need)) n = Math.min(n, Math.floor((pool[ion] || 0) / need[ion]));
    formed[prod] = n;
    for (const ion of Object.keys(need)) pool[ion] -= need[ion] * n;
  }
  if (stage.gasGroup) {
    const n = formed[stage.gasGroup.via];
    delete formed[stage.gasGroup.via];
    for (const sp of stage.gasGroup.terms) formed[sp] = n;
  }
  const leftovers = {};
  for (const ion of Object.keys(pool)) if (pool[ion] > 0) leftovers[ion] = pool[ion];
  return { formed, leftovers };
}

/* coeffs: 反応物→生成物の順の係数配列。
   正否は模範との比較ではなく「原子数の保存＋最簡整数比」で判定する。 */
function checkStageCoeffs(stage, coeffs) {
  if (coeffs.some((c) => !Number.isInteger(c) || c < 1)) {
    return { ok: false, reason: "すべての係数を1以上の整数で入力してください" };
  }
  const left = stage.reactants.map((sp, i) => ({ sp, n: coeffs[i] }));
  const right = stage.products.map((sp, i) => ({ sp, n: coeffs[stage.reactants.length + i] }));
  const cmp = compareSides(left, right);
  if (!cmp.balanced) {
    return { ok: false, reason: "左右で原子の数が合っていません", cmp };
  }
  if (gcdAll(coeffs) !== 1) {
    return { ok: false, reason: "つり合っているけれど、係数は最も簡単な整数比にしよう", cmp };
  }
  return { ok: true, cmp };
}
