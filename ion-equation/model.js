"use strict";
/* model.js — 化学モデル（DOM非依存の純粋ロジック）
   化学種の定義・電離表・ステージ定義・原子数集計・係数判定。 */

const SPECIES = {
  // 分子（投入する形・式の項になる形）
  "HCl":     { disp: "HCl",      name: "塩化水素（塩酸）",   atoms: { H: 1, Cl: 1 },       charge: 0 },
  "NaOH":    { disp: "NaOH",     name: "水酸化ナトリウム",   atoms: { Na: 1, O: 1, H: 1 }, charge: 0 },
  "H2SO4":   { disp: "H₂SO₄",   name: "硫酸",               atoms: { H: 2, S: 1, O: 4 },  charge: 0 },
  // 三段中和（s14〜s16）。H を3個持つので、中和のたびに別の塩ができる
  "H3PO4":   { disp: "H₃PO₄",   name: "リン酸",             atoms: { H: 3, P: 1, O: 4 },  charge: 0 },
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
  "NaH2PO4": { disp: "NaH₂PO₄", name: "リン酸二水素ナトリウム", atoms: { Na: 1, H: 2, P: 1, O: 4 }, charge: 0 },
  "Na2HPO4": { disp: "Na₂HPO₄", name: "リン酸水素二ナトリウム", atoms: { Na: 2, H: 1, P: 1, O: 4 }, charge: 0 },
  "Na3PO4":  { disp: "Na₃PO₄", name: "リン酸ナトリウム",   atoms: { Na: 3, P: 1, O: 4 }, charge: 0 },
  "CaCl2":   { disp: "CaCl₂",   name: "塩化カルシウム",     atoms: { Ca: 1, Cl: 2 },      charge: 0 },
  // 塩基性塩（s13）。Ca(OH)₂ を塩酸で半分だけ中和すると残る塩
  "CaCl(OH)": { disp: "CaCl(OH)", name: "塩化水酸化カルシウム", atoms: { Ca: 1, Cl: 1, O: 1, H: 1 }, charge: 0 },
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
  "PO4^3-":  { disp: "PO₄³⁻", name: "リン酸イオン",       atoms: { P: 1, O: 4 },   charge: -3 },
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
  /* 「比例式でみる化学計算」（/ratio/）と同じ式を索引で引けるようにするための種。
     参照エントリ専用なので房（PARTS）と作図（LAYOUT）は持たない */
  "CaCO3":       { disp: "CaCO₃",      name: "炭酸カルシウム（石灰石・水にとけない）", atoms: { Ca: 1, C: 1, O: 3 }, charge: 0 },
  "Al2(SO4)3":   { disp: "Al₂(SO₄)₃", name: "硫酸アルミニウム",   atoms: { Al: 2, S: 3, O: 12 }, charge: 0 },
  "N2":          { disp: "N₂",         name: "窒素",             atoms: { N: 2 },              charge: 0 },
  "Cl2":         { disp: "Cl₂",        name: "塩素",             atoms: { Cl: 2 },             charge: 0 },
  // 溶液中の酸化還元（KMnO₄・K₂Cr₂O₇ 系。参照エントリ用。房・アニメは未実装）
  "KMnO4":     { disp: "KMnO₄",      name: "過マンガン酸カリウム", atoms: { K: 1, Mn: 1, O: 4 }, charge: 0 },
  "MnO4-":     { disp: "MnO₄⁻",      name: "過マンガン酸イオン（赤紫）", atoms: { Mn: 1, O: 4 }, charge: -1 },
  "Mn^2+":     { disp: "Mn²⁺",       name: "マンガン(Ⅱ)イオン（ほぼ無色）", atoms: { Mn: 1 }, charge: 2 },
  /* 中性・塩基性で MnO₄⁻ が還元されたときの行き先（M6-D）。酸性の Mn²⁺ と違って
     水にとけない黒褐色の固体なので、液性で式が変わったことが色で分かる */
  "MnO2":      { disp: "MnO₂",       name: "酸化マンガン(Ⅳ)（黒褐色）", atoms: { Mn: 1, O: 2 }, charge: 0 },
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
  // 銅と硝酸（希→NO・濃→NO₂）。硝酸は酸と酸化剤の二役をこなす
  "NO":        { disp: "NO",          name: "一酸化窒素（無色）",   atoms: { N: 1, O: 1 }, charge: 0 },
  "NO2":       { disp: "NO₂",        name: "二酸化窒素（赤褐色）", atoms: { N: 1, O: 2 }, charge: 0 },
  "Cu(NO3)2":  { disp: "Cu(NO₃)₂",  name: "硝酸銅(Ⅱ)",           atoms: { Cu: 1, N: 2, O: 6 }, charge: 0 },
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
  // 電池モード（B3）の電解液。板の金属のイオンを溶かした水溶液を、それぞれの槽に入れる
  "MgSO4":         { disp: "MgSO₄",          name: "硫酸マグネシウム",                 atoms: { Mg: 1, S: 1, O: 4 }, charge: 0 },
  // 電気分解（B3・e1）の電解液
  "CuCl2":         { disp: "CuCl₂",          name: "塩化銅(Ⅱ)",                       atoms: { Cu: 1, Cl: 2 }, charge: 0 },
  // 金属×イオン（r1〜r4）の参照エントリで、分子反応式の生成物として要る塩
  "ZnCl2":         { disp: "ZnCl₂",          name: "塩化亜鉛",                         atoms: { Zn: 1, Cl: 2 }, charge: 0 },
  // 弱酸（部分電離）
  "CH3COOH":       { disp: "CH₃COOH",        name: "酢酸（弱酸）",                     atoms: { C: 2, H: 4, O: 2 }, charge: 0 },
  "CH3COO-":       { disp: "CH₃COO⁻",       name: "酢酸イオン",                       atoms: { C: 2, H: 3, O: 2 }, charge: -1 },
  "CH3COONa":      { disp: "CH₃COONa",       name: "酢酸ナトリウム",                   atoms: { C: 2, H: 3, O: 2, Na: 1 }, charge: 0 },
  // 弱塩基（アンモニア水）
  "NH4+":          { disp: "NH₄⁺",          name: "アンモニウムイオン",               atoms: { N: 1, H: 4 }, charge: 1 },
  "NH4Cl":         { disp: "NH₄Cl",          name: "塩化アンモニウム",                 atoms: { N: 1, H: 4, Cl: 1 }, charge: 0 },
  "(NH4)2SO4":     { disp: "(NH₄)₂SO₄",     name: "硫酸アンモニウム",                 atoms: { N: 2, H: 8, S: 1, O: 4 }, charge: 0 },
  // C群（分子の組み換え）: 気体分子と、ばらけた原子
  "O2":            { disp: "O₂",             name: "酸素",                             atoms: { O: 2 }, charge: 0 },
  "H2O2":          { disp: "H₂O₂",           name: "過酸化水素",                       atoms: { H: 2, O: 2 }, charge: 0 },
  "O3":            { disp: "O₃",             name: "オゾン",                           atoms: { O: 3 }, charge: 0 },
  /* 硫黄まわり（M6-F）。H₂S の S は −2 で、硫黄がとれるいちばん下の酸化数
     ＝ H₂S は還元剤にしかなれない。酸化されると単体の S（淡黄色・水にとけない）になる */
  "H2S":           { disp: "H₂S",            name: "硫化水素（腐卵臭）",               atoms: { H: 2, S: 1 }, charge: 0 },
  "S":             { disp: "S",               name: "硫黄（淡黄色・水にとけない）",     atoms: { S: 1 }, charge: 0 },
  /* 有機の酸化還元（アルコールの段階的酸化）。disp は構造が見えるように書く
     — 酸化数を「どの炭素か」の真下に出すには、化学式の中で炭素の位置が分かる必要がある */
  "C2H5OH":        { disp: "CH₃CH₂OH",       name: "エタノール",                       atoms: { C: 2, H: 6, O: 1 }, charge: 0 },
  "CH3CHO":        { disp: "CH₃CHO",         name: "アセトアルデヒド",                 atoms: { C: 2, H: 4, O: 1 }, charge: 0 },
  "C3H7OH":        { disp: "CH₃CH(OH)CH₃",   name: "2-プロパノール",                   atoms: { C: 3, H: 8, O: 1 }, charge: 0 },
  "CH3COCH3":      { disp: "CH₃COCH₃",       name: "アセトン",                         atoms: { C: 3, H: 6, O: 1 }, charge: 0 },
  /* ヨードホルム反応。メチル基の H が1つずつ I に置き換わり、最後に切れて CHI₃（黄色沈殿）になる */
  "I2":            { disp: "I₂",             name: "ヨウ素",                           atoms: { I: 2 }, charge: 0 },
  "I-":            { disp: "I⁻",             name: "ヨウ化物イオン",                   atoms: { I: 1 }, charge: -1 },
  /* 試薬として選ぶ形（REAGENTS）。還元剤としてはたらくのは I⁻ のほう */
  "KI":            { disp: "KI",             name: "ヨウ化カリウム",                   atoms: { K: 1, I: 1 }, charge: 0 },
  // ↓2種は現在未使用。ヨードホルム反応の「1個ずつヨード化する段階表示」を将来足すときの
  //   中間体として用意してある（酸化数のデータも組で保持。消さずに残す）
  "CH3COCI3":      { disp: "CH₃COCI₃",       name: "1,1,1-トリヨードアセトン",         atoms: { C: 3, H: 3, I: 3, O: 1 }, charge: 0 },
  "CI3CHO":        { disp: "CI₃CHO",         name: "トリヨードアセトアルデヒド",       atoms: { C: 2, H: 1, I: 3, O: 1 }, charge: 0 },
  "CHI3":          { disp: "CHI₃",           name: "ヨードホルム（黄色沈殿）",         atoms: { C: 1, H: 1, I: 3 }, charge: 0 },
  "HCOO-":         { disp: "HCOO⁻",          name: "ギ酸イオン",                       atoms: { C: 1, H: 1, O: 2 }, charge: -1 },
  /* ヨードホルム反応の全体式に出てくる塩（索引で式を引けるようにするため。
     半反応式はイオンで書くので、遊ぶ画面には出てこない） */
  "NaI":           { disp: "NaI",            name: "ヨウ化ナトリウム",                 atoms: { Na: 1, I: 1 }, charge: 0 },
  "HCOONa":        { disp: "HCOONa",         name: "ギ酸ナトリウム",                   atoms: { C: 1, H: 1, O: 2, Na: 1 }, charge: 0 },
  /* 切り離したメチル基。C–C の電子対を相手側に置いていくので「＋」が付き、
     炭素の酸化数は分子の中の −3 から **−2** になる（これが半反応式の出発点） */
  "CH3+":          { disp: "CH₃⁺",            name: "メチル基（切り離した断片）",       atoms: { C: 1, H: 3 }, charge: 1 },
  "CH3CO-":        { disp: "CH₃CO⁻",          name: "アセチル（残った断片）",           atoms: { C: 2, H: 3, O: 1 }, charge: -1 },
  "CHO-":          { disp: "CHO⁻",            name: "ホルミル（残った断片）",           atoms: { C: 1, H: 1, O: 1 }, charge: -1 },
  "CH4":           { disp: "CH₄",            name: "メタン",                           atoms: { C: 1, H: 4 }, charge: 0 },
  "C2H6":          { disp: "C₂H₆",           name: "エタン",                           atoms: { C: 2, H: 6 }, charge: 0 },
  "C3H8":          { disp: "C₃H₈",           name: "プロパン",                         atoms: { C: 3, H: 8 }, charge: 0 },
  "H":             { disp: "H",              name: "水素原子",                         atoms: { H: 1 }, charge: 0 },
  "O":             { disp: "O",              name: "酸素原子",                         atoms: { O: 1 }, charge: 0 },
  "C":             { disp: "C",              name: "炭素原子",                         atoms: { C: 1 }, charge: 0 },
  "N":             { disp: "N",              name: "窒素原子",                         atoms: { N: 1 }, charge: 0 },
  "Cl":            { disp: "Cl",             name: "塩素原子",                         atoms: { Cl: 1 }, charge: 0 },
};

/* C群（分子の組み換え）の分解表。イオンではなく**原子**にばらける。
   燃焼・化合・分解では「原子は増えも減りもしない」ことが最も直接に見える。 */
const ATOMIZATION = {
  "H2":  ["H", "H"],
  "O2":  ["O", "O"],
  "N2":  ["N", "N"],
  "Cl2": ["Cl", "Cl"],
  "CH4": ["C", "H", "H", "H", "H"],
  "C2H6": ["C", "C", "H", "H", "H", "H", "H", "H"],
};

/* 弱電解質（部分電離）。水に入れても**ほとんどが分子のまま**で、
   相手（OH⁻ など）に H⁺ を奪われると、残った分子がさらに電離して補う（ルシャトリエの原理）。
   ビーカーでは分子として溶かし、反応で必要になった時にこの表に従って電離させる。 */
const WEAK_ELECTROLYTES = {
  "CH3COOH": ["H+", "CH3COO-"],
};

/* 強電解質の電離表（v1 は完全電離のみ扱う） */
/* 弱塩基の電離。OH⁻ を持っていないのに塩基として働くのは、**水から H⁺ を奪って OH⁻ を残す**から。
   弱電解質と同じく「相手が来たときに初めて分かれる」（＝OH⁻ が使われるときだけ電離が進む＝
   ルシャトリエ）が、こちらは分解に**溶媒の水を1個使う**ところが違う。
   反応式に H₂O が現れるのはこのため。 */
const WATER_IONIZATION = {
  "NH3": { solvent: "H2O", parts: ["NH4+", "OH-"] },
};

/* 塩の加水分解（M4）。弱酸の塩・弱塩基の塩をとかすと液性がかたよる。
   起きていることは上の2つの表とまったく同じで、**物質によってどちらの型かが違う**だけ:
     ・CH₃COO⁻ は水から H⁺ を**奪う**（WATER_IONIZATION の NH₃ と同型。溶媒の水を1個使う）
       → CH₃COO⁻ ＋ H₂O ⇄ CH₃COOH ＋ OH⁻　＝ 塩基性
     ・NH₄⁺ は H⁺ を**放す**（WEAK_ELECTROLYTES の CH₃COOH と同型。水は要らない）
       → NH₄⁺ ⇄ NH₃ ＋ H⁺　＝ 酸性
   NH₃ でやったことが酢酸イオンでも起きるのは偶然ではなく、どちらもブレンステッドの塩基だから。

   **ただし表ではなくステージのルールに持たせる**。加水分解する種は他のステージにも出てくるので
   （CH₃COO⁻ は酢酸の中和・弱酸の遊離にも登場する）、全体の表に書くと
   「中和で OH⁻ が足りないから酢酸イオンをほどいて OH⁻ を作る」という嘘の反応が起きる。
   分かれ方はそのステージの中だけの話にする、が要点。

   もう1つ、既存の2つの表と決定的に違うのが**相手を待たないこと**。弱電解質も弱塩基も
   「相手が来たときだけ分かれる」が、加水分解は相手がいなくても勝手に少しだけ進む（平衡）。
   だから rule の find は1種でよく、代わりに per（何個に1個が分かれるか）を持つ。

   **v167 で名前を広げた。** 同じ仕組みが弱酸そのものの電離（電離度）にも要ったため。
   加水分解と電離は化学としては別物だが、**画面の上でやることは同じ**——
   相手を待たずに per 個に1個だけ分かれ、残りはそのまま、矢印は ⇄、
   「ちょうど反応しきる」評価は当てはまらない。共通なのはそこまでで、
   **言い回しは kind で分ける**（「加水分解で」なのか「電離して」なのか）。 */
const PARTIAL_KINDS = ["hydrolysis", "ionization"];

/* 相手を待たずに一部だけ進む反応（加水分解・電離）のルールを引く */
function partialRule(stage) {
  return ((stage && stage.rules) || []).find((r) => PARTIAL_KINDS.includes(r.kind)) || null;
}

/* ---- モード一覧（ヘッダーの帯の出どころ）----
   このアプリには行き先が8つある。**以前は6ページがそれぞれ帯を手書きしていて**、
   どのページから何へ行けるかがばらばらだった（48マス中27マスしか埋まっていない）。
   その結果、いちばん新しい2つが事実上たどり着けない状態になっていた:
     ・電池・電気分解（v158〜v162）… 6ページ中 redox からしかリンクが無く、
       battery.html 自身は 化学レンズ と 酸化還元 の2本だけ ＝ 行き止まり
     ・自由に組み合わせる（v148〜v157）… index.html（正面玄関）から行けない
   どちらも portal.html（ハブがアプリの入口として指しているページ）にも載っていなかった。

   モードを足すたびに6ページへ手でリンクを配るのは、必ずどこかが抜ける。
   **表は1つにして、帯は各ページで組み立てる**（header-ui.js）。
   `group` は並び順のための区分けで、意味は次のとおり:
     play … 反応そのものを動かすモード／tool … 書き換え・組み立ての道具／
     find … さがす入口／hub … 化学レンズへ戻る
   並びは全ページで同じにする ＝ 位置で覚えられるようにする、が主眼。 */
const MODES = [
  { id: "hub",       href: "../index.html",      label: "🏠 化学レンズ",        group: "hub" },
  { id: "index",     href: "index.html",         label: "イオン反応モード",      group: "play" },
  { id: "redox",     href: "redox.html",         label: "酸化還元モード",        group: "play" },
  { id: "battery",   href: "battery.html",       label: "🔋 電池をつくる",       group: "play" },
  { id: "free",      href: "redox.html?free=1",  label: "⚗ 自由に組み合わせる",  group: "tool" },
  { id: "condition", href: "condition.html",     label: "⚖ 液性で書き換える",    group: "tool" },
  { id: "portal",    href: "portal.html",        label: "☰ 単元から入る",       group: "find" },
  { id: "library",   href: "library.html",       label: "🔎 反応インデックス",   group: "find" },
];

/* いま開いているページ（id）から見た帯の中身。自分自身は出さない。
   `free` は redox.html の変種なので、redox にいるときも出す（そこから入るのが自然）。 */
function modeBarFor(currentId) {
  return MODES.filter((m) => m.id !== currentId);
}

/* 比予想クイズ。「この2つは何 : 何で反応するか」を**先に当ててから**試す出題。
   ふつうの遊び方は「1個ずつ足して、余ったらもう1個」の試行錯誤で、それはそれで
   よく効くが、**最後まで比を意識しないまま解けてしまう**。先に言い切らせると、
   同じ操作が「予想を確かめる実験」になる。

   正解の比は模範投入数（sampleInputs）を最簡整数比にしたもの ＝ **導出**。
   ステージごとに正解の比を手で書くと、係数を直したとき片方だけ古くなる。

   出題できないステージ:
     ・反応物が1種（比になる相手がいない）
     ・加水分解・電離（相手を待たない反応なので「何 : 何」という問いが立たない） */
function ratioQuizOf(stage) {
  if (!stage || !stage.reactants || stage.reactants.length < 2) return null;
  if (partialRule(stage)) return null;
  const n = sampleInputs(stage);
  if (n.length !== stage.reactants.length) return null;
  if (n.some((v) => !Number.isInteger(v) || v < 1)) return null;
  const g = gcdAll(n) || 1;
  return { species: stage.reactants.slice(), answer: n.map((v) => v / g) };
}

/* 予想した比が正解か。**倍でも正解にする**（2:4 は 1:2 と同じ比）。
   ここを「模範と同じ数」で見ると、比が合っているのに×になる */
function ratioGuessOk(quiz, guess) {
  if (!quiz || !guess || guess.length !== quiz.answer.length) return false;
  if (guess.some((v) => !Number.isInteger(v) || v < 1)) return false;
  const g = gcdAll(guess) || 1;
  return guess.every((v, i) => v / g === quiz.answer[i]);
}

/* 部分中和でできる塩の種類を、**ビーカーに残るイオンから導く**（手で書かない）。
   OH⁻ が残れば塩基性塩、H を持つイオンが残れば酸性塩。
   v172 で塩基性塩（s13）を足すまでは画面の文言が「酸性塩」で固定されていて、
   CaCl(OH) を「酸性塩」と呼んでしまっていた。名前を手で書くと、
   2つ目の型が来たときにこうなる。 */
function saltKindOf(saltGoal) {
  const ions = Object.keys((saltGoal && saltGoal.ions) || {});
  if (ions.includes("OH-")) return "塩基性塩";
  if (ions.some((sp) => (SPECIES[sp].atoms.H || 0) > 0)) return "酸性塩";
  return "塩";
}

/* 模範どおりに遊ぶとき、ビーカーへ入れる反応物の個数。
   ふつうは反応式の左辺の係数だが、**一部しか進むわけではない反応（加水分解・電離）は
   per 個入れないと1個ぶんも起こらない**。
   ここを answer に手書きすると、per を変えたときに黙ってずれる（模範どおり入れたのに
   何も起きない画面になる）ので、per から**導く**。
   ＝ 加水分解・電離のステージは top-level の answer を持たない。 */
function sampleInputs(stage) {
  const p = partialRule(stage);
  if (p) return [p.per];
  return (stage.answer || []).slice(0, stage.reactants.length);
}

const DISSOCIATION = {
  "HCl":     ["H+", "Cl-"],
  "NaOH":    ["Na+", "OH-"],
  "H2SO4":   ["H+", "H+", "SO4^2-"],
  // リン酸は3価。このアプリは多価の酸を「H⁺ を価数ぶん出す」形で一律に扱う
  "H3PO4":   ["H+", "H+", "H+", "PO4^3-"],
  "Na3PO4":  ["Na+", "Na+", "Na+", "PO4^3-"],
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
  "Cu(NO3)2":  ["Cu^2+", "NO3-", "NO3-"],
  // 錯塩は「錯イオン＋対イオン」に電離する（錯イオンは水中でひとまとまりのまま）
  "Cu(NH3)4SO4": ["Cu(NH3)4^2+", "SO4^2-"],
  "Ag(NH3)2NO3": ["Ag(NH3)2^+", "NO3-"],
  "Ag(NH3)2Cl":  ["Ag(NH3)2^+", "Cl-"],
  "Cu(NH3)4(OH)2": ["Cu(NH3)4^2+", "OH-", "OH-"],
  // 両性水酸化物 系
  "AlCl3":      ["Al^3+", "Cl-", "Cl-", "Cl-"],
  "ZnSO4":      ["Zn^2+", "SO4^2-"],
  "MgSO4":      ["Mg^2+", "SO4^2-"],
  "CuCl2":      ["Cu^2+", "Cl-", "Cl-"],
  // 金属×イオン（r1〜r4）の生成物。どちらも強電解質なので水中では完全に電離している
  "ZnCl2":      ["Zn^2+", "Cl-", "Cl-"],
  "Al2(SO4)3":  ["Al^3+", "Al^3+", "SO4^2-", "SO4^2-", "SO4^2-"],
  "NaAl(OH)4":  ["Na+", "Al(OH)4^-"],
  "Na2Zn(OH)4": ["Na+", "Na+", "Zn(OH)4^2-"],
  // 弱酸の塩は強電解質（完全電離する）
  "CH3COONa":   ["Na+", "CH3COO-"],
  "HCOONa":     ["Na+", "HCOO-"],
  "NaI":        ["Na+", "I-"],
  // 弱塩基の塩も強電解質
  "NH4Cl":      ["NH4+", "Cl-"],
  "(NH4)2SO4":  ["NH4+", "NH4+", "SO4^2-"],
  // ↑は電離表。数合わせビューでは NH₄Cl と同じく「NH₃ が H⁺ を受け取った姿」まで開く（下の PARTS）
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
  // 両性水酸化物。沈殿そのものを反応物にするステージ（再溶解の2段目）で要る
  "Al(OH)3": ["Al^3+", "OH-", "OH-", "OH-"],
  "Zn(OH)2": ["Zn^2+", "OH-", "OH-"],
  "H2SO3": ["H+", "H+", "SO3^2-"],
  "SO2":   ["SO2"],
  // 酸性塩は「中和で残った H⁺ が傍観アニオン・陽イオンと組んだ塩」として分解して見せる
  "NaHSO4": ["Na+", "H+", "SO4^2-"],
  "NaHCO3": ["Na+", "H+", "CO3^2-"],
  // 塩基性塩も同じ。こちらは中和で残った OH⁻ が陽イオン・傍観アニオンと組んだ姿
  "CaCl(OH)": ["Ca^2+", "OH-", "Cl-"],
  // リン酸の酸性塩2種。NaHSO₄ と同じく「中和で残った H⁺ が組んだ姿」として開く
  "NaH2PO4": ["Na+", "H+", "H+", "PO4^3-"],
  "Na2HPO4": ["Na+", "Na+", "H+", "PO4^3-"],
  // 電離しない分子（配位子）はそれ自身
  "NH3":   ["NH3"],
  // これ以上ほどけないイオンもそれ自身。電離式（CH₃COOH ⇄ CH₃COO⁻ ＋ H⁺）のように
  // 反応式の項にイオンが直接出る反応では、数合わせビューがここを引く
  "CH3COO-": ["CH3COO-"],
  "H+":      ["H+"],
  /* 炭素の単体は固体（黒鉛）で、ばらけようがないので自分自身。
     **ATOMIZATION には入れない。** あちらは「反応の瞬間にほどく種」の表で、
     ここへ C を入れるとエンジンが C を延々ほどき続け、CO₂ を作らなくなる
     （実際 v169 の作業中にメタンの燃焼が全部落ちて気づいた）。
     PARTS 側だけに置けば、数合わせビューが引けて、エンジンは触らない */
  "C":       ["C"],
  // 錯塩は「中心イオン＋配位子＋対イオン」まで開く（何個が組んだかを数えられるように）
  "Cu(NH3)4SO4": ["Cu^2+", "NH3", "NH3", "NH3", "NH3", "SO4^2-"],
  "Ag(NH3)2NO3": ["Ag+", "NH3", "NH3", "NO3-"],
  "Ag(NH3)2Cl":  ["Ag+", "NH3", "NH3", "Cl-"],
  "Cu(NH3)4(OH)2": ["Cu^2+", "NH3", "NH3", "NH3", "NH3", "OH-", "OH-"],
  // 両性水酸化物が溶けてできる塩は「陽イオン＋中心イオン＋OH⁻」まで開く
  "NaAl(OH)4":  ["Na+", "Al^3+", "OH-", "OH-", "OH-", "OH-"],
  "Na2Zn(OH)4": ["Na+", "Na+", "Zn^2+", "OH-", "OH-", "OH-", "OH-"],
  // 弱酸は「電離しにくい」だけで、中和に使える H⁺ の総量は分子の数どおり（数合わせでは開いて見せる）
  "CH3COOH":    ["H+", "CH3COO-"],
  // 弱塩基の塩は「NH₃ が H⁺ を受け取って対イオンと組んだ姿」として開く
  "NH4Cl":      ["NH3", "H+", "Cl-"],
  "(NH4)2SO4":  ["NH3", "H+", "NH3", "H+", "SO4^2-"],
});

/* 表示用の「構成イオン」。沈殿や錯イオンを、もとのイオンが枠に収まった姿として描く。
   枠の形で状態を区別する: 〇枠＝水にとけているイオン／□枠＝沈殿（固体）。 */
const COMPOSITION = {
  // 沈殿（□枠）
  "AgCl":      ["Ag+", "Cl-"],
  "BaSO4":     ["Ba^2+", "SO4^2-"],
  "Cu(OH)2":   ["Cu^2+", "OH-", "OH-"],
  "Al(OH)3":   ["Al^3+", "OH-", "OH-", "OH-"],
  "Zn(OH)2":   ["Zn^2+", "OH-", "OH-"],
  // 錯イオン・多原子イオン（〇枠）
  "Cu(NH3)4^2+": ["Cu^2+", "NH3", "NH3", "NH3", "NH3"],
  "Ag(NH3)2^+":  ["Ag+", "NH3", "NH3"],
  "Al(OH)4^-":   ["Al^3+", "OH-", "OH-", "OH-", "OH-"],
  "Zn(OH)4^2-":  ["Zn^2+", "OH-", "OH-", "OH-", "OH-"],
  "NH4+":        ["NH3", "H+"],
};

/* 固体（沈殿）として描く種。COMPOSITION の枠を□にする */
const SOLID_SPECIES = new Set(["AgCl", "BaSO4", "Cu(OH)2", "Al(OH)3", "Zn(OH)2"]);

/* 錯イオンの立体構造（配位子の並べ方）。中心イオンのまわりに対称に配置して、
   正方形（平面四配位）と正四面体の違いが図から分かるようにする。
   square = 四隅（□の形）／tetra = 上下左右（◇の形）／linear = 左右（直線） */
const COORDINATION = {
  "Cu(NH3)4^2+": "square",   // 正方形（平面四配位）
  "Ag(NH3)2^+":  "linear",   // 直線二配位
  "Zn(OH)4^2-":  "tetra",    // 正四面体
  "Al(OH)4^-":   "tetra",    // 正四面体
};

/* 配位子を置く相対位置。中心イオンからのオフセット（見た目専用）。
   square = 四隅（□。正方形の平面四配位）／tetra = 上下左右（◇。正四面体）／linear = 左右。
   中心と配位子の輪郭が少し重なる距離にして、結びついていることを示す（硫酸イオンと同じ流儀）。 */
const COORDINATION_OFFSETS = {
  square: [[-14, -14], [14, -14], [-14, 14], [14, 14]],
  tetra:  [[0, -19], [19, 0], [0, 19], [-19, 0]],
  linear: [[-19, 0], [19, 0]],
};

/* 数合わせビュー用の分解を、ステージごとに上書きできるようにする。
   同じ H₂O でも A群（水溶液）では H⁺＋OH⁻、C群（分子の組み換え）では H＋H＋O と見せたいため。 */
function partsOf(stage, sp) {
  return (stage && stage.parts && stage.parts[sp]) || PARTS[sp];
}

/* 中和の模式図（ブロック図）用の分解。
   中和は「H⁺ を何個やりとりするか」より「H⁺ と OH⁻ が 1:1 で結びついて H₂O になる」と
   見たほうが分かりやすい、という方針にもとづく。各反応物を
   ［本体イオン ＋ n個の受け渡し粒］というブロックに分け、描画側はこの結果だけを使う。

   返り値:
     hNeed/accNeed … 生成物1個あたりに要る H⁺ / 受け皿の個数（H⁺+OH⁻→H₂O なら 1,1）
     accSp         … 受け皿の種（OH⁻・CO₃²⁻・NH₃ など）
     product       … 1組が結びついてできる種の配列
     donors        … H⁺ を持つ反応物 [{ sp, i, per, core }]（core＝残る本体イオン）
     acceptors     … 受け皿を持つ反応物（同上）
   H⁺ の受け渡しが軸でない反応（沈殿・錯イオン・燃焼）では null。 */
function protonSchema(stage) {
  if (!stage || !stage.rules) return null;
  const rule = stage.rules.find((r) => r.find.some((x) => x === "H+"));
  if (!rule) return null;
  const hNeed = rule.find.filter((x) => x === "H+").length;
  const accSp = rule.find.find((x) => x !== "H+");
  if (!accSp) return null;
  const accNeed = rule.find.filter((x) => x === accSp).length;

  const donors = [], acceptors = [];
  stage.reactants.forEach((sp, i) => {
    const parts = partsOf(stage, sp) || [];
    const h = parts.filter((x) => x === "H+").length;
    const a = parts.filter((x) => x === accSp).length;
    // 両方を持つ種は「出す側」として扱う（水など。中和の主役は H⁺ の側）
    if (h > 0) donors.push({ sp, i, per: h, core: parts.filter((x) => x !== "H+") });
    else if (a > 0) acceptors.push({ sp, i, per: a, core: parts.filter((x) => x !== accSp) });
  });
  if (!donors.length || !acceptors.length) return null;

  return {
    hNeed, accSp, accNeed,
    product: Array.isArray(rule.make) ? rule.make.slice() : [rule.make],
    donors, acceptors,
  };
}

/* 模式図の個数計算。coeffs（反応式の係数配列）から、H⁺・受け皿の総数と
   結びつく組の数・あまりを求める。描画にもテストにも同じ数を使う。 */
function protonBalance(schema, coeffs) {
  const sum = (list) => list.reduce((s, t) => s + t.per * ((coeffs && coeffs[t.i]) || 0), 0);
  const hTotal = sum(schema.donors);
  const accTotal = sum(schema.acceptors);
  const pairs = Math.min(Math.floor(hTotal / schema.hNeed), Math.floor(accTotal / schema.accNeed));
  return {
    hTotal, accTotal, pairs,
    hLeft: hTotal - pairs * schema.hNeed,
    accLeft: accTotal - pairs * schema.accNeed,
  };
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
  // O と H は水平に並べる（斜め上に置くと右上の電荷バッジと重なるため）
  "OH-":    { env: 17, atoms: [
    { el: "O", x: -5, y: 0, r: 9 }, { el: "H", x: 7, y: 0, r: 6 }] },
  "SO4^2-": { env: 24, atoms: [
    { el: "S", x: 0, y: 0, r: 9 },
    { el: "O", x: 0, y: -14, r: 7 }, { el: "O", x: 0, y: 14, r: 7 },
    { el: "O", x: -14, y: 0, r: 7 }, { el: "O", x: 14, y: 0, r: 7 }] },
  // リン酸イオン。硫酸イオンと同じ四面体の並びにして、見くらべられるようにする
  "PO4^3-": { env: 24, atoms: [
    { el: "P", x: 0, y: 0, r: 9 },
    { el: "O", x: 0, y: -14, r: 7 }, { el: "O", x: 0, y: 14, r: 7 },
    { el: "O", x: -14, y: 0, r: 7 }, { el: "O", x: 14, y: 0, r: 7 }] },
  /* 三段中和でできる3つの塩。PO₄ の四面体を真ん中に置き、まわりに Na と H を並べる。
     3つを見くらべたときに **Na と H の数だけが入れ替わっている**と分かるよう、
     PO₄ の位置と、Na・H を置く4か所は3つとも同じにしてある */
  "H3PO4":   { atoms: [
    { el: "P", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -12, r: 6.5 }, { el: "O", x: 0, y: 12, r: 6.5 },
    { el: "O", x: -12, y: 0, r: 6.5 }, { el: "O", x: 12, y: 0, r: 6.5 },
    { el: "H", x: -19, y: -8, r: 5 }, { el: "H", x: 19, y: -8, r: 5 }, { el: "H", x: 0, y: 21, r: 5 }] },
  "NaH2PO4": { atoms: [
    { el: "P", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -12, r: 6.5 }, { el: "O", x: 0, y: 12, r: 6.5 },
    { el: "O", x: -12, y: 0, r: 6.5 }, { el: "O", x: 12, y: 0, r: 6.5 },
    { el: "Na", x: -21, y: -9, r: 8 }, { el: "H", x: 19, y: -8, r: 5 }, { el: "H", x: 0, y: 21, r: 5 }] },
  "Na2HPO4": { atoms: [
    { el: "P", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -12, r: 6.5 }, { el: "O", x: 0, y: 12, r: 6.5 },
    { el: "O", x: -12, y: 0, r: 6.5 }, { el: "O", x: 12, y: 0, r: 6.5 },
    { el: "Na", x: -21, y: -9, r: 8 }, { el: "Na", x: 21, y: -9, r: 8 }, { el: "H", x: 0, y: 21, r: 5 }] },
  "Na3PO4":  { atoms: [
    { el: "P", x: 0, y: 0, r: 8 },
    { el: "O", x: 0, y: -12, r: 6.5 }, { el: "O", x: 0, y: 12, r: 6.5 },
    { el: "O", x: -12, y: 0, r: 6.5 }, { el: "O", x: 12, y: 0, r: 6.5 },
    { el: "Na", x: -21, y: -9, r: 8 }, { el: "Na", x: 21, y: -9, r: 8 }, { el: "Na", x: 0, y: 22, r: 8 }] },
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
  // 中心の C と H の輪郭を少し重ねて、結びついていることを示す
  "CH4":    { atoms: [
    { el: "C", x: 0, y: 0, r: 10 },
    { el: "H", x: -10, y: -8, r: 6 }, { el: "H", x: 10, y: -8, r: 6 },
    { el: "H", x: -10, y: 8, r: 6 }, { el: "H", x: 10, y: 8, r: 6 }] },
  // エタン（1列に8原子なので、原子レベルの詳細アニメで扱える上限あたり）
  "C2H6":   { atoms: [
    { el: "C", x: -9, y: 2, r: 8 }, { el: "C", x: 9, y: 2, r: 8 },
    { el: "H", x: -19, y: -7, r: 5 }, { el: "H", x: -19, y: 11, r: 5 }, { el: "H", x: -9, y: 14, r: 5 },
    { el: "H", x: 19, y: -7, r: 5 }, { el: "H", x: 19, y: 11, r: 5 }, { el: "H", x: 9, y: 14, r: 5 }] },
  // プロパン（原子数が多いので、ビーカーでは分子のまま組み替える＝簡易モード）
  "C3H8":   { atoms: [
    { el: "C", x: -16, y: 2, r: 8 }, { el: "C", x: 0, y: 2, r: 8 }, { el: "C", x: 16, y: 2, r: 8 },
    { el: "H", x: -26, y: -6, r: 5 }, { el: "H", x: -26, y: 10, r: 5 }, { el: "H", x: -16, y: 13, r: 5 },
    { el: "H", x: 0, y: -9, r: 5 }, { el: "H", x: 0, y: 13, r: 5 },
    { el: "H", x: 26, y: -6, r: 5 }, { el: "H", x: 26, y: 10, r: 5 }, { el: "H", x: 16, y: 13, r: 5 }] },
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
  /* 塩基性塩（s13）。Ca(OH)₂ の OH の片方が Cl に置き換わった姿にしてある ——
     並べて見たときに「片方だけ中和された」と分かるように、Ca と残った OH の
     位置は Ca(OH)₂ と同じにして、右側の OH があった場所へ Cl を置く */
  "CaCl(OH)": { atoms: [
    { el: "Ca", x: 0, y: 2, r: 9 },
    { el: "O", x: -13, y: -6, r: 7 }, { el: "H", x: -18, y: -11, r: 5 },
    { el: "Cl", x: 14, y: -5, r: 8 }] },
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
    title: "塩酸 × 水酸化ナトリウム",
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
    title: "硫酸 × 水酸化ナトリウム",
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
    title: "塩酸 × 水酸化カルシウム",
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
    title: "硝酸銀 × 塩化ナトリウム（沈殿）",
    reactants: ["AgNO3", "NaCl"],
    products: ["AgCl", "NaNO3"],
    answer: [1, 1, 1, 1],
    ionic: { reactants: ["Ag+", "Cl-"], products: ["AgCl"], answer: [1, 1, 1] },
    rules: [{ find: ["Ag+", "Cl-"], make: "AgCl", kind: "precipitate" }],
    netIon: "Ag⁺ ＋ Cl⁻ → AgCl↓",
    intro: "AgNO₃ と NaCl を入れて反応させてみよう。今度は水ではなく、白い沈殿ができる。",
    doneNote: "AgCl は水に溶けないので沈殿として底に積もる。Na⁺ と NO₃⁻ は溶けたまま（傍観イオン）。",
  },
  {
    id: "s5",
    title: "塩化バリウム × 硫酸ナトリウム（沈殿）",
    reactants: ["BaCl2", "Na2SO4"],
    products: ["BaSO4", "NaCl"],
    answer: [1, 1, 1, 2],
    ionic: { reactants: ["Ba^2+", "SO4^2-"], products: ["BaSO4"], answer: [1, 1, 1] },
    rules: [{ find: ["Ba^2+", "SO4^2-"], make: "BaSO4", kind: "precipitate" }],
    netIon: "Ba²⁺ ＋ SO₄²⁻ → BaSO₄↓",
    intro: "白い沈殿 BaSO₄ ができる。沈殿にならないイオンが何個残るかに注目しよう。",
    doneNote: "BaSO₄ は水に溶けず沈殿する。Na⁺ と Cl⁻ は溶けたまま（傍観イオン。蒸発させると NaCl）。",
  },
  {
    id: "s6",
    title: "炭酸ナトリウム × 塩酸（気体発生）",
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
    title: "硝酸 × 水酸化カリウム",
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
    title: "硫酸 × 水酸化バリウム（中和＋沈殿）",
    reactants: ["H2SO4", "Ba(OH)2"],
    products: ["BaSO4", "H2O"],
    answer: [1, 1, 1, 2],
    rules: [
      { find: ["H+", "OH-"], make: "H2O", kind: "combine" },
      { find: ["Ba^2+", "SO4^2-"], make: "BaSO4", kind: "precipitate" },
    ],
    netIon: "H⁺＋OH⁻→H₂O と Ba²⁺＋SO₄²⁻→BaSO₄↓ が同時に起こる",
    // 傍観イオンが1つも残らない（doneNote のとおり）。クリア時の1行に
    // 「— ほかのイオンは傍観イオン」の結びを付けると自己矛盾するので、フラグで抑止する
    noSpectator: true,
    intro: "この反応では2つの組み変わりが同時に起こる。反応のあと、水に残るイオンはあるだろうか？",
    doneNote: "中和と沈殿が同時に起こり、傍観イオンが1つも残らない珍しい反応。溶液はほぼ純水になる。",
  },
  {
    id: "s9",
    title: "硫酸銅 × 水酸化ナトリウム（青白色の沈殿）",
    reactants: ["CuSO4", "NaOH"],
    products: ["Cu(OH)2", "Na2SO4"],
    answer: [1, 2, 1, 1],
    // OH⁻ がどこから来ても沈殿そのものはこの式。アンモニア水版とも同じ式になる
    ionic: { reactants: ["Cu^2+", "OH-"], products: ["Cu(OH)2"], answer: [1, 2, 1] },
    rules: [{ find: ["Cu^2+", "OH-", "OH-"], make: "Cu(OH)2", kind: "precipitate" }],
    netIon: "Cu²⁺ ＋ 2OH⁻ → Cu(OH)₂↓（青白色）",
    intro: "青い水溶液に塩基を加えると、青白色の沈殿ができる。Cu²⁺ は OH⁻ を何個つかまえる？",
    doneNote: "Cu²⁺ 1個が OH⁻ 2個と組んで Cu(OH)₂ の沈殿になる。沈殿の色は無機化学の重要な手がかり。",
  },
  {
    id: "s10",
    title: "亜硫酸ナトリウム × 塩酸（気体発生）",
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
    title: "硫酸 × 水酸化ナトリウム（酸性塩をつくる）",
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
    title: "炭酸ナトリウム × 塩酸（酸性塩をつくる）",
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
  /* 塩基性塩。s11（多価の**酸**を部分中和して酸性塩）とちょうど鏡で、
     こちらは多価の**塩基**を部分中和する。同じ「部分中和」から
     酸性塩と塩基性塩の両方が出てくる、と並べて見せられるのが値打ち。

     教科書でよく挙がる塩基性塩は MgCl(OH)（Mg(OH)₂ ＋ HCl）だが、
     Mg(OH)₂ は水に溶けないので**ビーカーでイオンに分けて見せられない**。
     Ca(OH)₂ は水にとける（石灰水）ので、このアプリの土俵に乗るのはこちら。
     考え方は同じなので、MgCl(OH) のほうは doneNote で名前を出しておく。 */
  {
    id: "s13",
    title: "水酸化カルシウム × 塩酸（塩基性塩をつくる）",
    reactants: ["Ca(OH)2", "HCl"],
    products: ["CaCl(OH)", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    // 完全中和（1:2）だと正塩 CaCl₂ になってしまい、塩基性塩にはならない
    saltGoal: {
      label: "CaCl(OH)",
      ions: { "Ca^2+": 1, "OH-": 1, "Cl-": 1 },
      overNote: "酸を入れすぎると完全に中和して正塩 CaCl₂ になる。CaCl(OH) には HCl を Ca(OH)₂ と同数だけ（1:1）に。",
    },
    netIon: "H⁺ ＋ OH⁻ → H₂O（Ca(OH)₂ の OH⁻ 2個のうち1個だけ中和される）",
    intro: "Ca(OH)₂ は OH⁻ を2個持つ。塩酸を1個だけ入れて OH⁻ を1個だけ中和すると、残りはどうなる？　s11（酸性塩）と見くらべてみよう。",
    doneNote: "OH⁻ 1個だけが H⁺ と中和し、残った OH⁻ が Ca²⁺・Cl⁻ と組む ＝ 塩の中に OH が残っているので塩基性塩。s11 の酸性塩とは鏡の関係で、酸性塩は「中和しきらず酸の H が残った塩」、塩基性塩は「中和しきらず塩基の OH が残った塩」。どちらも多価（H を2個以上／OH を2個以上）でなければ作れない。教科書では塩基性塩の例として MgCl(OH)（Mg(OH)₂ ＋ HCl）がよく挙がる。考え方はまったく同じで、Mg(OH)₂ は水にとけないのでここではとける Ca(OH)₂ で見せている。なお「塩基性塩だから水溶液が塩基性」とはかぎらない（液性は塩の名前ではなく、もとの酸と塩基の強弱で決まる）。",
  },
  /* リン酸の三段中和（s14〜s16）。**3本そろって1つの話**なので、まとめて足してある。
     H を3個持つ酸なので、入れる塩基の数で 3種類の塩を作り分けられる:
       1個 → NaH₂PO₄（酸性塩・H が2個残る）
       2個 → Na₂HPO₄（酸性塩・H が1個残る）
       3個 → Na₃PO₄ （正塩・H は残らない）
     s11（H₂SO₄ の二段のうち1段）で見せた「入れる量で塩が変わる」を、
     3段まで伸ばして**並べて見くらべられる**ようにしたもの。
     索引では related（ラベルをデータが持つ汎用リンク）で互いへ飛べるようにしてある。

     リン酸は本当は中程度の強さの酸で3段の電離定数もばらばらだが、
     このアプリは多価の酸を一律に「H⁺ を価数ぶん出す」形で扱う（H₂SO₄ と同じ）。
     係数の数え方を見せるのが目的で、強さの話はここではしない。 */
  {
    id: "s14",
    title: "リン酸 × 水酸化ナトリウム 1:1（三段中和の1段目）",
    reactants: ["H3PO4", "NaOH"],
    products: ["NaH2PO4", "H2O"],
    answer: [1, 1, 1, 1],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    saltGoal: {
      label: "NaH2PO4",
      ions: { "Na+": 1, "H+": 2, "PO4^3-": 1 },
      overNote: "塩基を入れすぎると2段目・3段目まで進んでしまう。NaH₂PO₄ には NaOH を H₃PO₄ と同数だけ（1:1）に。",
    },
    netIon: "H⁺ ＋ OH⁻ → H₂O（H₃PO₄ の H⁺ 3個のうち1個だけ中和される）",
    intro: "リン酸は H を3個持つ。NaOH を1個だけ入れると、H⁺ は何個残る？",
    doneNote: "H⁺ 3個のうち1個だけが中和され、残り2個が Na⁺・PO₄³⁻ と組む＝酸性塩 NaH₂PO₄。ここから NaOH を足していくと 2段目（Na₂HPO₄）・3段目（Na₃PO₄）へ進む。同じ酸から3種類の塩が作り分けられるのは、H を3個持っているから。",
  },
  {
    id: "s15",
    title: "リン酸 × 水酸化ナトリウム 1:2（三段中和の2段目）",
    reactants: ["H3PO4", "NaOH"],
    products: ["Na2HPO4", "H2O"],
    answer: [1, 2, 1, 2],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    saltGoal: {
      label: "Na2HPO4",
      ions: { "Na+": 2, "H+": 1, "PO4^3-": 1 },
      overNote: "あと1個入れると3段目まで進んで正塩 Na₃PO₄ になる。Na₂HPO₄ には NaOH を H₃PO₄ の2倍だけ（1:2）に。",
    },
    netIon: "2H⁺ ＋ 2OH⁻ → 2H₂O（H₃PO₄ の H⁺ 3個のうち2個が中和される）",
    intro: "同じリン酸に NaOH を2個入れるとどうなる？　1段目（NaH₂PO₄）と見くらべてみよう。",
    doneNote: "H⁺ 3個のうち2個が中和され、残り1個が Na⁺ 2個・PO₄³⁻ と組む＝酸性塩 Na₂HPO₄。1段目との違いは NaOH を1個多く入れただけで、酸も塩基も同じもの。酸性塩は「中和しきらず酸の H が残った塩」なので、H が2個残っても1個残っても酸性塩。",
  },
  {
    id: "s16",
    title: "リン酸 × 水酸化ナトリウム 1:3（三段中和の3段目・正塩）",
    reactants: ["H3PO4", "NaOH"],
    products: ["Na3PO4", "H2O"],
    answer: [1, 3, 1, 3],
    rules: [{ find: ["H+", "OH-"], make: "H2O", kind: "combine" }],
    // ここは完全中和なので saltGoal は要らない（余るイオンがない＝ふつうの中和）
    netIon: "3H⁺ ＋ 3OH⁻ → 3H₂O（H₃PO₄ の H⁺ 3個すべてが中和される）",
    intro: "3個目の NaOH を入れて、H⁺ を全部中和しきるとどうなる？",
    doneNote: "H⁺ 3個すべてが中和され、H が残らない＝正塩 Na₃PO₄。1段目 NaH₂PO₄・2段目 Na₂HPO₄ とここまでの3つを並べると、酸性塩と正塩の違いが「H が残っているかどうか」だけだと分かる。なお正塩でも水溶液が中性とはかぎらない（Na₃PO₄ は弱酸の塩なので加水分解して塩基性）。",
  },
  /* アンモニア水で沈殿させる版。NaOH 版（s9・1段階）と対になる2段階。
     NH₃ は OH⁻ を持っていないのに塩基として働く＝**水から H⁺ を奪って OH⁻ を残す**から。
     そのぶん反応式に H₂O が現れるが、水は溶媒なので投入ボタンには出さない
     （ビーカーの試薬＝reactants と、式の項＝molecular/ionic を分けている）。 */
  {
    id: "cu-nh3-step1",
    title: "硫酸銅 × アンモニア水（少量：沈殿）",
    reactants: ["CuSO4", "NH3"],
    products: ["Cu(OH)2", "(NH4)2SO4"],
    answer: [1, 2, 1, 1],
    molecular: {
      reactants: ["CuSO4", "NH3", "H2O"], products: ["Cu(OH)2", "(NH4)2SO4"], answer: [1, 2, 2, 1, 1],
    },
    // 傍観の SO₄²⁻ を除くと本質はこれ。NaOH 版（s9）の Cu²⁺＋2OH⁻→Cu(OH)₂ に
    // 「OH⁻ の出どころ（NH₃＋H₂O→NH₄⁺＋OH⁻）」を足したかたち
    ionic: {
      reactants: ["Cu^2+", "NH3", "H2O"], products: ["Cu(OH)2", "NH4+"], answer: [1, 2, 2, 1, 2],
    },
    primary: "ionic",
    rules: [{ find: ["Cu^2+", "OH-", "OH-"], make: "Cu(OH)2", kind: "precipitate" }],
    netIon: "Cu²⁺ ＋ 2NH₃ ＋ 2H₂O → Cu(OH)₂↓ ＋ 2NH₄⁺（NH₃ が水から H⁺ を奪って OH⁻ を出す）",
    intro: "アンモニア水を少しだけ加えても、NaOH のときと同じ青白い沈殿ができる。NH₃ は OH⁻ を持っていないのに、なぜ？",
    doneNote: "NH₃ は水から H⁺ を奪って NH₄⁺ になり、あとに OH⁻ が残る（NH₃＋H₂O→NH₄⁺＋OH⁻）。その OH⁻ が Cu²⁺ と組むので、沈殿そのものは NaOH のときと同じ Cu²⁺＋2OH⁻→Cu(OH)₂。だから2つの反応はイオン反応式で書くと同じ式になる。ここへさらにアンモニア水を加えると、次のステージのように沈殿が溶ける。",
  },
  {
    id: "cu-nh3-step2",
    title: "水酸化銅(Ⅱ) × アンモニア水（過剰：再溶解）",
    reactants: ["Cu(OH)2", "NH3"],
    products: ["Cu(NH3)4(OH)2"],
    answer: [1, 4, 1],
    ionic: {
      reactants: ["Cu(OH)2", "NH3"], products: ["Cu(NH3)4^2+", "OH-"], answer: [1, 4, 1, 2],
    },
    primary: "ionic",
    rules: [{ find: ["Cu(OH)2", "NH3", "NH3", "NH3", "NH3"], make: ["Cu(NH3)4^2+", "OH-", "OH-"], kind: "complex" }],
    intermediates: ["Cu(OH)2"],
    netIon: "Cu(OH)₂ ＋ 4NH₃ → [Cu(NH₃)₄]²⁺ ＋ 2OH⁻（深青色になって溶ける）",
    intro: "前のステージでできた青白い沈殿に、アンモニア水をさらに加えると溶けて濃い青色になる。NH₃ は何個必要？",
    doneNote: "ここでは NH₃ は電離せず、分子のまま Cu²⁺ を4個で取り囲む（配位）。押し出された OH⁻ は溶液に戻る。同じ NH₃ が、少量では「水から OH⁻ を出す塩基」・過剰では「配位子」として働くのがこの2段の面白いところ。",
  },
  {
    // id は reactions.json の反応 id と一致させる（インデックスからの ?rxn ディープリンク用）
    id: "complex-cu-nh3",
    title: "硫酸銅 × アンモニア（過剰・中間を省いた式）",
    reactants: ["CuSO4", "NH3"],
    products: ["Cu(NH3)4SO4"],
    answer: [1, 4, 1],
    // 配位: NH₃ は電離せず分子のまま Cu²⁺ を取り囲む（電子の移動はない）
    rules: [{ find: ["Cu^2+", "NH3", "NH3", "NH3", "NH3"], make: "Cu(NH3)4^2+", kind: "complex" }],
    netIon: "Cu²⁺ ＋ 4NH₃ → [Cu(NH₃)₄]²⁺（深青色）",
    intro: "青い硫酸銅水溶液にアンモニアを加えると、NH₃ が Cu²⁺ にくっついて濃い青色になる。NH₃ は何個必要？",
    doneNote: "NH₃ 4個が Cu²⁺ を取り囲んで [Cu(NH₃)₄]²⁺（テトラアンミン銅(Ⅱ)イオン）に。この結びつきを配位といい、できたイオンが錯イオン。SO₄²⁻ は傍観イオン。実際には途中で Cu(OH)₂ の青白い沈殿を経る（前の2つのステージ）が、過剰のアンモニア水で最後どうなるかだけを書くとこの式になる。どちらの書き方も使われる。",
  },
  {
    id: "complex-ag-nh3",
    title: "硝酸銀 × アンモニア（錯イオン）",
    reactants: ["AgNO3", "NH3"],
    products: ["Ag(NH3)2NO3"],
    answer: [1, 2, 1],
    rules: [{ find: ["Ag+", "NH3", "NH3"], make: "Ag(NH3)2^+", kind: "complex" }],
    netIon: "Ag⁺ ＋ 2NH₃ → [Ag(NH₃)₂]⁺",
    intro: "銀イオンにアンモニアを加えると錯イオンができる。Cu²⁺ は4個だったが、Ag⁺ は何個の NH₃ とくっつく？",
    doneNote: "Ag⁺ は NH₃ を2個つかまえて [Ag(NH₃)₂]⁺（ジアンミン銀(Ⅰ)イオン）になる。中心のイオンによって配位する数（配位数）が違う。これは銀鏡反応に使うアンモニア性硝酸銀の正体。",
  },
  {
    id: "complex-agcl-nh3",
    title: "塩化銀 × アンモニア（沈殿の再溶解）",
    // 沈殿そのものが反応物。投入すると電離せず、そのまま底に沈む（app.js の dissociateMolecule）
    reactants: ["AgCl", "NH3"],
    products: ["Ag(NH3)2Cl"],
    answer: [1, 2, 1],
    rules: [{ find: ["AgCl", "NH3", "NH3"], make: ["Ag(NH3)2^+", "Cl-"], kind: "complex" }],
    intermediates: ["AgCl"],
    netIon: "AgCl ＋ 2NH₃ → [Ag(NH₃)₂]⁺ ＋ Cl⁻（白い沈殿がアンモニア水に溶ける）",
    intro: "ステージ4でできた白い沈殿 AgCl にアンモニア水を加えると、沈殿が溶けていく。NH₃ は何個必要？",
    doneNote: "AgCl は水にはとけないが、NH₃ が2個配位して [Ag(NH₃)₂]⁺ になると溶ける。AgBr はうすいアンモニア水には溶けにくく、AgI は溶けない — この溶けやすさの違いがハロゲン化銀の識別に使われる。",
  },
  /* 両性水酸化物は「少量で沈殿・過剰で再溶解」の2段。
     まとめて1本で書くこともあるが、2本に分けて初めて“量で結果が変わる”が式として見える。
     分割版（step1/step2）とまとめ版を両方置き、reactions.json の steps/combined で相互リンクする。 */
  {
    id: "amphoteric-al-step1",
    title: "塩化アルミニウム × 水酸化ナトリウム（少量：沈殿）",
    reactants: ["AlCl3", "NaOH"],
    products: ["Al(OH)3", "NaCl"],
    answer: [1, 3, 1, 3],
    // 傍観イオン（Na⁺・Cl⁻）を除くと本質はこれ。沈殿生成の標準的な書き方
    ionic: { reactants: ["Al^3+", "OH-"], products: ["Al(OH)3"], answer: [1, 3, 1] },
    primary: "ionic",
    rules: [{ find: ["Al^3+", "OH-", "OH-", "OH-"], make: "Al(OH)3", kind: "precipitate" }],
    netIon: "Al³⁺ ＋ 3OH⁻ → Al(OH)₃↓（白色ゲル状の沈殿）",
    intro: "Al³⁺ に NaOH を少しずつ加えると白い沈殿ができる。Al³⁺ 1個に OH⁻ は何個つく？",
    doneNote: "Al³⁺ の電荷は +3 なので、OH⁻ を3個つかまえて電気的に中性の Al(OH)₃ になる。ここで止めるのが「少量の NaOH」。さらに加えると次のステージのように溶けてしまう。",
  },
  {
    id: "amphoteric-al-step2",
    title: "水酸化アルミニウム × 水酸化ナトリウム（過剰：再溶解）",
    // 沈殿そのものが反応物。前のステージでできた沈殿に、さらに塩基を加えた状況
    reactants: ["Al(OH)3", "NaOH"],
    products: ["NaAl(OH)4"],
    answer: [1, 1, 1],
    ionic: { reactants: ["Al(OH)3", "OH-"], products: ["Al(OH)4^-"], answer: [1, 1, 1] },
    primary: "ionic",
    rules: [{ find: ["Al(OH)3", "OH-"], make: "Al(OH)4^-", kind: "complex" }],
    intermediates: ["Al(OH)3"],
    netIon: "Al(OH)₃ ＋ OH⁻ → [Al(OH)₄]⁻（沈殿が過剰の塩基に溶ける）",
    intro: "前のステージでできた白い沈殿に、さらに NaOH を加えると溶けていく。OH⁻ はあと何個必要？",
    doneNote: "Al(OH)₃ は OH⁻ をもう1個受け取って [Al(OH)₄]⁻ になり、水にとける。沈殿ができたあと過剰の塩基で溶ける＝両性水酸化物。少量の段（3個）と合わせて OH⁻ は合計4個になる。",
  },
  {
    id: "amphoteric-zn-step1",
    title: "硫酸亜鉛 × 水酸化ナトリウム（少量：沈殿）",
    reactants: ["ZnSO4", "NaOH"],
    products: ["Zn(OH)2", "Na2SO4"],
    answer: [1, 2, 1, 1],
    ionic: { reactants: ["Zn^2+", "OH-"], products: ["Zn(OH)2"], answer: [1, 2, 1] },
    primary: "ionic",
    rules: [{ find: ["Zn^2+", "OH-", "OH-"], make: "Zn(OH)2", kind: "precipitate" }],
    netIon: "Zn²⁺ ＋ 2OH⁻ → Zn(OH)₂↓（白色の沈殿）",
    intro: "Zn²⁺ の電荷は +2。少量の NaOH で白い沈殿ができる。OH⁻ は何個つく？",
    doneNote: "Zn²⁺ は OH⁻ を2個つかまえて Zn(OH)₂ になる。Al³⁺ が3個だったのは電荷が +3 だから — 沈殿に要る OH⁻ の数は陽イオンの電荷で決まる。",
  },
  {
    id: "amphoteric-zn-step2",
    title: "水酸化亜鉛 × 水酸化ナトリウム（過剰：再溶解）",
    reactants: ["Zn(OH)2", "NaOH"],
    products: ["Na2Zn(OH)4"],
    answer: [1, 2, 1],
    ionic: { reactants: ["Zn(OH)2", "OH-"], products: ["Zn(OH)4^2-"], answer: [1, 2, 1] },
    primary: "ionic",
    rules: [{ find: ["Zn(OH)2", "OH-", "OH-"], make: "Zn(OH)4^2-", kind: "complex" }],
    intermediates: ["Zn(OH)2"],
    netIon: "Zn(OH)₂ ＋ 2OH⁻ → [Zn(OH)₄]²⁻（沈殿が過剰の塩基に溶ける）",
    intro: "Zn(OH)₂ も過剰の NaOH に溶ける。Al のときは1個で足りたが、Zn では何個必要？",
    doneNote: "Zn(OH)₂ は OH⁻ をさらに2個受け取って [Zn(OH)₄]²⁻ になる。配位数はどちらも4で、少量の段と合わせて OH⁻ は Al も Zn も合計4個。違うのは「沈殿までに何個使うか」のほう。",
  },
  {
    id: "amphoteric-aloh3-naoh",
    title: "塩化アルミニウム × 水酸化ナトリウム（両性・まとめて1本）",
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
    title: "硫酸亜鉛 × 水酸化ナトリウム（両性・まとめて1本）",
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
    title: "酢酸 × 水酸化ナトリウム（弱酸）",
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
    id: "weak-acid-free-ch3coona-hcl",
    title: "酢酸ナトリウム × 塩酸（弱酸の遊離）",
    reactants: ["CH3COONa", "HCl"],
    products: ["CH3COOH", "NaCl"],
    answer: [1, 1, 1, 1],
    // 強酸の H⁺ が CH₃COO⁻ に取りつき、電離しない弱酸の分子に戻す
    rules: [{ find: ["H+", "CH3COO-"], make: "CH3COOH", kind: "combine" }],
    /* 置き換えビュー: ステージ18（酢酸×NaOH）でちょうど中和した図から始め、
       塩酸が入ってきて「中和の座」を奪い、弱い酸が分子のまま押し出される、を見せる。
       from＝いま中和している酸／to＝あとから来る強酸／base＝相手の塩基。 */
    displace: { from: "CH3COOH", to: "HCl", base: "NaOH", fromStage: "weak-acid-ch3cooh-naoh" },
    netIon: "CH₃COO⁻ ＋ H⁺ → CH₃COOH（強い酸が弱い酸を追い出す）",
    intro: "ステージ18でできた酢酸ナトリウムに塩酸を加える。強い酸が入ってくると、弱い酸はどうなるだろう？",
    doneNote: "強酸の H⁺ が CH₃COO⁻ に取りつき、電離しない酢酸の分子に戻る＝弱酸の遊離。中和の座は塩酸が奪い、Na⁺ は Cl⁻ と組む。「強い酸は弱い酸をその塩から追い出す」— 炭酸塩や亜硫酸塩に塩酸を加えると気体が出る（ステージ6・10）のも、遊離した弱酸が気体だからで、同じ反応の仲間。",
  },
  {
    id: "weak-base-nh3-hcl",
    title: "アンモニア × 塩酸（弱塩基）",
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
  /* 弱酸の塩の加水分解。酢酸ナトリウムは中性の塩に見えて、水溶液は**塩基性**になる。
     理由は CH₃COO⁻ が水から H⁺ を奪って酢酸の分子に戻り、あとに OH⁻ が残るから
     ＝ cu-nh3-step1 の NH₃＋H₂O→NH₄⁺＋OH⁻ とまったく同じ振る舞い（どちらもブレンステッドの塩基）。

     **「ちょうど反応しきる」型ではない**。加水分解は平衡で、入れた塩のごく一部しか進まない
     （0.1 mol/L の酢酸ナトリウムなら1万個に1個ほど）。全部が加水分解する画を出すと嘘になるので、
     rule.per で「per 個に1個だけ分かれる」とし、残りがもとのイオンのまま残ることを画面に残す。
     クリアは「加水分解が1組でも起きて液性がかたよったこと」＋係数（DESIGN_ionic_two_step.md §6）。 */
  {
    id: "hydrolysis-ch3coona",
    title: "酢酸ナトリウム水溶液（弱酸の塩の加水分解）",
    reactants: ["CH3COONa"],
    products: ["CH3COOH", "NaOH"],
    // top-level の answer は持たない。式は下の molecular / ionic が持ち、
    // 投入数は per から導く（sampleInputs）。ここに数を書くと二重管理になる
    // 式には溶媒の水が現れるので、ビーカーの試薬（reactants）と式の項が一致しない
    molecular: { reactants: ["CH3COONa", "H2O"], products: ["CH3COOH", "NaOH"], answer: [1, 1, 1, 1] },
    // 傍観の Na⁺ を除くとこれが本質。OH⁻ が出るから塩基性、が一目で分かる
    ionic: { reactants: ["CH3COO-", "H2O"], products: ["CH3COOH", "OH-"], answer: [1, 1, 1, 1] },
    primary: "ionic",
    rules: [{ find: ["CH3COO-"], solvent: "H2O", make: ["CH3COOH", "OH-"], kind: "hydrolysis", per: 5 }],
    netIon: "CH₃COO⁻ ＋ H₂O ⇄ CH₃COOH ＋ OH⁻（酢酸イオンが水から H⁺ を奪い、OH⁻ が残る）",
    intro: "酢酸ナトリウムは「酸と塩基がちょうど中和してできた塩」なのに、水にとかすと中性にならない。何が起きているか、粒で見てみよう（ごく一部しか変わらないので、少し多めに入れること）。",
    doneNote: "CH₃COO⁻ は水から H⁺ を1個奪って酢酸の分子に戻り、H⁺ を取られた水は OH⁻ として残る ＝ だから塩基性。これはアンモニアが塩基としてはたらくのと同じ仕組みで（NH₃＋H₂O→NH₄⁺＋OH⁻）、どちらも「H⁺ の受け取り手＝ブレンステッドの塩基」だからそろって同じ形になる。弱い酸の陰イオンほど H⁺ を欲しがるので加水分解しやすく、強酸の陰イオン（Cl⁻・NO₃⁻）はまったく加水分解しない ＝ 塩の水溶液の液性は「もとの酸と塩基のどちらが強かったか」で決まる。なお実際に加水分解するのは1万個に1個ほどで、ここでは見えるように誇張してある。",
  },
  /* 弱塩基の塩の加水分解。塩化アンモニウム水溶液は**酸性**。
     酢酸ナトリウム（1つ前）と背中合わせで、2つ並べて初めて
     「塩の水溶液の液性は、もとの酸と塩基のどちらが強かったかで決まる」が両側から見える。
     CH₃COO⁻ が水から H⁺ を**奪う**のに対し、NH₄⁺ は H⁺ を**放す**（水は要らない）。

     **この反応には分子反応式を書かない**（noMolecular）。教科書は
     NH₄Cl ＋ H₂O ⇄ NH₃·H₂O ＋ HCl と書くが、これには NH₃·H₂O（アンモニア水をひとつの分子と
     見る書き方）が要る。このアプリは v93 以来ずっと **NH₃ と H₂O を別々に扱って**きたので
     （NH₃＋H₂O→NH₄⁺＋OH⁻）、ここだけ NH₃·H₂O を持ち込むと自分の流儀を破る。
     かといって水を外して NH₄Cl ⇄ NH₃ ＋ HCl と書くのは**もっと悪い**。
     それは加熱したときの話で、水の中に分子の HCl は存在しない。
     酢酸ナトリウム側が分子反応式を持てるのは、CH₃COONa ＋ H₂O ⇄ CH₃COOH ＋ NaOH が
     そのまま釣り合うから ＝ **左右で持ち物が違うのはごまかしではなく、書けるものが違うから**。

     H⁺ を H₃O⁺ と書く流儀（NH₄⁺＋H₂O⇄NH₃＋H₃O⁺）も採らない。このアプリは電離をすべて
     裸の H⁺ で描いており（HCl→H⁺＋Cl⁻・中和は H⁺＋OH⁻→H₂O）、ここだけ H₃O⁺ を出すと
     画面の中で H⁺ が2通りの姿を持つ。教科書がそう書くことは doneNote で伝える。 */
  {
    id: "hydrolysis-nh4cl",
    title: "塩化アンモニウム水溶液（弱塩基の塩の加水分解）",
    reactants: ["NH4Cl"],
    // NH₃ を生成物に挙げておくのは必須。挙げないと WATER_IONIZATION の
    // NH₃＋H₂O→NH₄⁺＋OH⁻ に拾われて「作ってはほどく」を延々くり返す
    products: ["NH3"],
    // 酢酸ナトリウムと同じく top-level の answer は持たない（式は ionic・投入数は per から）
    ionic: { reactants: ["NH4+"], products: ["NH3", "H+"], answer: [1, 1, 1] },
    primary: "ionic",
    noMolecular: "教科書の NH₄Cl ＋ H₂O ⇄ NH₃·H₂O ＋ HCl には NH₃·H₂O が要るが、このアプリは NH₃ と H₂O を別々に扱っている。水を外した NH₄Cl ⇄ NH₃ ＋ HCl は加熱したときの式で、水の中では起きない",
    // solvent を持たない ＝ 水を使わずに H⁺ を手放す（CH₃COO⁻ の側との唯一の違い）
    rules: [{ find: ["NH4+"], make: ["NH3", "H+"], kind: "hydrolysis", per: 5 }],
    netIon: "NH₄⁺ ⇄ NH₃ ＋ H⁺（アンモニウムイオンが H⁺ を手放す）",
    intro: "塩化アンモニウムも「酸と塩基がちょうど中和してできた塩」。こちらは水にとかすとどちらへかたよる？　酢酸ナトリウムのときと見くらべてみよう（やはりごく一部しか変わらないので、少し多めに入れること）。",
    doneNote: "NH₄⁺ は H⁺ を1個手放して NH₃ に戻る ＝ だから酸性。酢酸ナトリウムの CH₃COO⁻ が水から H⁺ を「奪う」のとちょうど裏返しで、こちらは水を使わずに H⁺ を「放す」。まとめると、塩の水溶液の液性は もとの酸と塩基のうち弱いほうが顔を出す ＝ 弱酸＋強塩基の塩は塩基性、強酸＋弱塩基の塩は酸性、強酸＋強塩基の塩（NaCl など）はどちらも顔を出さないので中性。なお教科書はこの反応を NH₄⁺ ＋ H₂O ⇄ NH₃ ＋ H₃O⁺ と書くことがある。H₃O⁺ は「水とくっついた H⁺」のことで、このアプリが描いている裸の H⁺ と同じものを指している。",
  },
  /* 弱酸そのものの電離（電離度）。加水分解で作った per の仕組みがそのまま使える。
     **ステージ18（酢酸×NaOH）とわざと食い違わせてある。** あちらは酢酸を分子のままにして
     「中和のときだけ電離して補う」を見せる筋書きで、常時の微小電離を省いてある。
     省略していることをどこかで回収しないと、生徒は「酢酸は中和されるまで電離しない」と
     覚えてしまう。ここがその回収で、doneNote で両者の関係を明かす。

     式は**電離式1本**。ionic を持たないので切り替えは自動的に出ない
     （CH₃COOH ⇄ CH₃COO⁻ ＋ H⁺ に「分子反応式」と「イオン反応式」の区別は無い）。 */
  {
    id: "ionization-ch3cooh",
    title: "酢酸水溶液（弱酸の電離度）",
    reactants: ["CH3COOH"],
    products: ["CH3COO-", "H+"],
    answer: [1, 1, 1],
    rules: [{ find: ["CH3COOH"], make: ["H+", "CH3COO-"], kind: "ionization", per: 5 }],
    netIon: "CH₃COOH ⇄ CH₃COO⁻ ＋ H⁺（入れた分子のうち、ごく一部だけが電離する）",
    intro: "塩酸なら、入れた HCl はすべて H⁺ と Cl⁻ に分かれた。酢酸を入れるとどうなる？　何個入れたら何個が分かれるか、数えてみよう（変わるのは一部なので、少し多めに入れること）。",
    doneNote: "強酸（塩酸）は入れたぶんが全部電離するのに対し、弱酸は一部しか電離しない。この「電離した分子の数 ÷ 溶かした分子の数」が電離度。0.1 mol/L の酢酸なら実際は100個に1個ほどで、ここでは見えるように誇張してある。ここで大事なのは、電離度が小さくても中和に使える H⁺ の総量は減らないこと ＝ 分子のまま残っている酢酸も、H⁺ が使われれば次々に電離して補う（ルシャトリエ）。ステージ18（酢酸×NaOH）で酢酸を分子のままにして中和のときだけ電離させたのは、中和の筋道を見やすくするための省略で、実際にはこのステージのように最初から一部が電離している。",
  },
  /* 炭素の燃焼。燃焼の式のいちばん簡単な形（係数がすべて1）で、
     ここを起点に CH₄・C₂H₆ と分子が大きくなっても数え方は変わらない、と言える。

     C群でただ1つ、**反応物が分子ではなく固体（原子1個）**の回。
     そのため (1) 場の名前を「気体の空間」から言い換える（固体を気体の空間に描くと嘘）、
     (2) C は ATOMIZATION に入れない（ほどきようがないし、入れるとエンジンが
     ほどき続けて CO₂ を作らなくなる。v169 で実際に踏んだ）、の2点だけ他と違う。 */
  {
    id: "combustion-c-o2",
    title: "炭素の燃焼（分子の組み換え）",
    phase: "gas",
    spaceLabel: "反応の場（水にとけていない。炭は固体）",
    reactants: ["C", "O2"],
    products: ["CO2"],
    answer: [1, 1, 1],
    rules: [{ find: ["C", "O", "O"], make: "CO2", kind: "combine" }],
    parts: { "CO2": ["C", "O", "O"] },
    intermediates: ["O2"],
    netIon: "C ＋ O₂ → CO₂（炭素の燃焼。係数はすべて1）",
    intro: "炭が燃えると二酸化炭素ができる。燃焼の式のいちばん簡単な形。炭素と酸素は何個ずつ？",
    doneNote: "CO₂ に要る O は2個で、O₂ 1個がちょうど2個ぶん。だから係数はすべて1になる。炭素は固体なので、ほかの回のように分子がばらける段階が無く、はじめから原子1個で待っている（ここだけ場の名前を「反応の場」としてあるのはそのため）。この形が分かれば、CH₄ や C₂H₆ のように分子が大きくなっても数え方は同じ ── C は CO₂ へ、H は H₂O へ行き、それに要る O をあとから数える。",
  },
  {
    id: "combustion-h2-o2",
    title: "水素の燃焼（分子の組み換え）",
    phase: "gas",   // 水溶液ではなく気体の空間
    reactants: ["H2", "O2"],
    products: ["H2O"],
    answer: [2, 1, 2],
    // イオンではなく原子にばらけて、組み替わる
    rules: [{ find: ["H", "H", "O"], make: "H2O", kind: "combine" }],
    parts: { "H2O": ["H", "H", "O"] },   // この群では水を「H・H・O」として見せる
    intermediates: ["H2", "O2"],          // 反応しきれずに残った分子は未完了
    // 分子は反応の瞬間にほどける（投入した時点ではばらさない）
    // クリア時の見出し側が「原子の組み替え」を名乗るので、ここで繰り返さない
    netIon: "2H₂ ＋ O₂ → 2H₂O（イオンは出ない）",
    intro: "ここは水の中ではなく気体の空間。水素と酸素が原子にばらけて組み替わる。H₂ と O₂ は何個ずつ？",
    doneNote: "分子がいったん原子にばらけ、H2個とO1個が組んで H₂O になる。原子は増えも減りもせず、組み合わせが変わるだけ — これが化学変化の本質で、反応式の係数はその個数合わせ。",
  },
  {
    id: "combustion-ch4-o2",
    title: "メタンの燃焼（分子の組み換え）",
    phase: "gas",
    reactants: ["CH4", "O2"],
    products: ["CO2", "H2O"],
    answer: [1, 2, 1, 2],
    rules: [
      { find: ["C", "O", "O"], make: "CO2", kind: "combine" },
      { find: ["H", "H", "O"], make: "H2O", kind: "combine" },
    ],
    parts: { "H2O": ["H", "H", "O"], "CO2": ["C", "O", "O"] },
    intermediates: ["CH4", "O2"],
    netIon: "CH₄ ＋ 2O₂ → CO₂ ＋ 2H₂O（都市ガスが燃えるときの反応）",
    intro: "メタン（都市ガス）が燃えると二酸化炭素と水ができる。C・H・O の数がぴったり合うように O₂ を何個入れる？",
    doneNote: "CH₄ の C は CO₂ に、H は H₂O になる。必要な O は CO₂ に2個・H₂O 2個に2個で計4個＝O₂ 2個ぶん。炭素を含む物質が燃えると必ず CO₂ と H₂O ができる、が燃焼の基本形。",
  },
  {
    id: "combustion-c2h6-o2",
    title: "エタンの燃焼（分子の組み換え）",
    phase: "gas",
    reactants: ["C2H6", "O2"],
    products: ["CO2", "H2O"],
    answer: [2, 7, 4, 6],
    rules: [
      { find: ["C", "O", "O"], make: "CO2", kind: "combine" },
      { find: ["H", "H", "O"], make: "H2O", kind: "combine" },
    ],
    parts: { "H2O": ["H", "H", "O"], "CO2": ["C", "O", "O"] },
    intermediates: ["C2H6", "O2"],
    netIon: "2C₂H₆ ＋ 7O₂ → 4CO₂ ＋ 6H₂O",
    intro: "エタンは C が2個・H が6個。C₂H₆ 1個から CO₂ と H₂O はいくつできる？ 係数が奇数になる場面に注意。",
    doneNote: "C₂H₆ 1個から CO₂ 2個・H₂O 3個。必要な O は 2×2＋3×1＝7個＝O₂ 3.5個ぶん。半端を避けるため C₂H₆ を2個にすると O₂ は7個＝整数になり、これが 2C₂H₆＋7O₂→4CO₂＋6H₂O の理由。",
  },
  {
    id: "combustion-c3h8-o2",
    title: "プロパンの燃焼（分子の組み換え）",
    phase: "gas",
    // 原子が多すぎて並びきらないので、分子のまま組み替える簡易表示にする
    animMode: "simple",
    reactants: ["C3H8", "O2"],
    products: ["CO2", "H2O"],
    answer: [1, 5, 3, 4],
    // 簡易モードでは反応式まるごとを1組として扱う
    rules: [{
      find: ["C3H8", "O2", "O2", "O2", "O2", "O2"],
      make: ["CO2", "CO2", "CO2", "H2O", "H2O", "H2O", "H2O"],
      kind: "combine",
    }],
    parts: {
      "C3H8": ["C", "C", "C", "H", "H", "H", "H", "H", "H", "H", "H"],
      "O2": ["O", "O"], "CO2": ["C", "O", "O"], "H2O": ["H", "H", "O"],
    },
    netIon: "C₃H₈ ＋ 5O₂ → 3CO₂ ＋ 4H₂O（カセットボンベなどの燃料）",
    intro: "プロパンは C が3個・H が8個。燃やすと CO₂ と H₂O がいくつできる？ O₂ は何個必要？（分子が大きいので、ここでは分子のまま組み替える）",
    doneNote: "C 3個 → CO₂ 3個、H 8個 → H₂O 4個。必要な O は 3×2＋4×1＝10個＝O₂ 5個ぶん。分子が大きくなっても「原子の数を合わせる」やり方は同じで、係数だけが大きくなる。",
  },
  /* 塩化水素の生成。**燃焼ではない化合**の代表で、水素の燃焼と骨格は同じ
     （2種の二原子分子がばらけて組み替わる）。1:1 で、係数の落とし穴が無いぶん
     「燃焼だから O₂ が要る」という思い込みを外すのに向く。
     なお HCl は水にとかせば強酸だが、ここは気体の空間なので**分子のまま**。
     PARTS の既定（H⁺＋Cl⁻）を parts で上書きしているのはそのため。 */
  {
    id: "synthesis-hcl",
    title: "塩化水素の生成（分子の組み換え）",
    phase: "gas",
    reactants: ["H2", "Cl2"],
    products: ["HCl"],
    answer: [1, 1, 2],
    rules: [{ find: ["H", "Cl"], make: "HCl", kind: "combine" }],
    parts: { "HCl": ["H", "Cl"] },
    intermediates: ["H2", "Cl2"],
    netIon: "H₂ ＋ Cl₂ → 2HCl（イオンは出ない。気体どうしの化合）",
    intro: "水素と塩素を混ぜて光を当てると、はげしく反応して塩化水素ができる。燃焼ではないが、やっていることは同じ「原子の組み替え」。H₂ と Cl₂ は何個ずつ？",
    doneNote: "H₂ 1個と Cl₂ 1個がばらけて、H と Cl が1個ずつ組んで HCl が2個できる。左辺の分子は2個・右辺も2個だが、分子の数がそろうのはたまたまで、そろえているのは原子の数。ここでできた HCl を水にとかしたものが塩酸で、そのとき初めて H⁺ と Cl⁻ に電離する（このステージで分子のままなのは、水が無い気体の空間だから）。",
  },
  /* アンモニアの合成。C群で唯一**分子の数が減る**反応（4個→2個）で、
     「分子の数」と「原子の数」を混同していると必ずつまずくところ。
     原子は N 2個・H 6個のまま変わらない。

     工業的にはハーバー・ボッシュ法で、実際には**平衡でぜんぶは進まない**。
     ただしここで per を使った「一部だけ進む」表現は採らない —— このステージが
     見せたいのは反応式の係数（原子の数合わせ）であって平衡ではなく、
     一部しか進まない画にすると「ちょうど反応しきる」比が読めなくなる。
     進みきらないことは doneNote で言葉にして渡す。 */
  {
    id: "synthesis-nh3",
    title: "アンモニアの合成（分子の組み換え）",
    phase: "gas",
    reactants: ["N2", "H2"],
    products: ["NH3"],
    answer: [1, 3, 2],
    rules: [{ find: ["N", "H", "H", "H"], make: "NH3", kind: "combine" }],
    // NH₃ は PARTS の既定では「分かれない分子」なので、ここでは原子まで開いて見せる
    parts: { "NH3": ["N", "H", "H", "H"] },
    intermediates: ["N2", "H2"],
    netIon: "N₂ ＋ 3H₂ → 2NH₃（原子の組み替え。イオンは出ない）",
    intro: "空気中の窒素からアンモニアをつくる反応。N₂ 1個に対して H₂ は何個要る？　できる分子の数にも注目。",
    doneNote: "N₂ 1個がほどけて N が2個。その N 1個ずつに H が3個つくので H は6個＝H₂ 3個ぶん要る。ここで大事なのは、分子の数は 4個（N₂1＋H₂3）から 2個（NH₃2）へ減るのに、原子の数は N 2個・H 6個のまま変わらないこと ── 反応式がそろえているのは分子の数ではなく原子の数。なおこれは工業的にはハーバー・ボッシュ法とよばれ、実際には高温・高圧にしても平衡でぜんぶは進まない（このステージでは係数を見るために、進みきった形で描いてある）。",
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
  s6:  ["気体発生", "弱酸の遊離", "正塩"],
  s7:  ["中和", "正塩"],
  s8:  ["中和", "沈殿", "正塩"],
  s9:  ["沈殿", "正塩"],
  s10: ["気体発生", "弱酸の遊離", "正塩"],
  s11: ["中和", "酸性塩"],
  s12: ["中和", "酸性塩"],
  s13: ["中和", "塩基性塩"],
  // 三段中和。1・2段目は酸性塩、3段目は正塩（同じ酸から作り分ける）
  s14: ["中和", "酸性塩"],
  s15: ["中和", "酸性塩"],
  s16: ["中和", "正塩"],
  "complex-cu-nh3": ["錯イオン", "配位"],
  "complex-ag-nh3": ["錯イオン", "配位"],
  "cu-nh3-step1": ["沈殿", "弱塩基", "錯イオン"],
  "cu-nh3-step2": ["錯イオン", "沈殿の再溶解", "配位"],
  "complex-agcl-nh3": ["錯イオン", "沈殿の再溶解", "沈殿", "ハロゲン化銀"],
  "amphoteric-al-step1": ["両性水酸化物", "沈殿"],
  "amphoteric-al-step2": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "amphoteric-zn-step1": ["両性水酸化物", "沈殿"],
  "amphoteric-zn-step2": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "amphoteric-aloh3-naoh": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "amphoteric-znoh2-naoh": ["両性水酸化物", "沈殿の再溶解", "錯イオン"],
  "weak-acid-ch3cooh-naoh": ["中和", "弱酸", "電離平衡", "正塩"],
  // 弱酸の遊離は s6・s10（遊離した弱酸が気体になる型）と同じ仲間。単元タグで串刺しにする
  "weak-acid-free-ch3coona-hcl": ["弱酸の遊離", "弱酸", "正塩"],
  "weak-base-nh3-hcl": ["中和", "弱塩基", "正塩"],
  // 塩の加水分解。塩そのものは正塩（中和しきってできた塩）だが、水溶液は中性にならない
  "hydrolysis-ch3coona": ["加水分解", "弱酸", "電離平衡", "正塩"],
  "hydrolysis-nh4cl": ["加水分解", "弱塩基", "電離平衡", "正塩"],
  // 塩ではなく弱酸そのものの電離。塩の話ではないので saltType のタグは付かない
  "ionization-ch3cooh": ["電離平衡", "弱酸"],
  "combustion-h2-o2": ["分子反応", "燃焼", "原子の保存"],
  // 燃焼ではない化合。「燃焼」タグは付けない
  "synthesis-hcl": ["分子反応", "化合", "原子の保存"],
  "combustion-c-o2": ["分子反応", "燃焼", "原子の保存"],
  // 燃焼ではない化合。分子の数が減る唯一の回
  "synthesis-nh3": ["分子反応", "化合", "原子の保存"],
  "combustion-ch4-o2": ["分子反応", "燃焼", "原子の保存"],
  "combustion-c2h6-o2": ["分子反応", "燃焼", "原子の保存"],
  "combustion-c3h8-o2": ["分子反応", "燃焼", "原子の保存"],
};

/* 表示時の元素の並び順（金属 → H → その他） */
const ELEMENT_ORDER = ["Na", "Ca", "Ag", "Ba", "Zn", "Cu", "H", "C", "N", "S", "O", "Cl"];

/* ---- 酸化還元モード（DESIGN_redox.md）---- */

/* 半反応式（部品）。left/right は e⁻ を含む項の一覧。原子・電荷保存はテストで検証。

   couple は「対（酸化型/還元型）」の名前で、**両側とも SPECIES の id** を使う
   （"Cu^2+/Cu"）。向きが違うだけの2本（Cu_ox と Cu_red・I2_red と I_ox）は
   **同じ couple** を指す。強さの順位（REDOX_LADDER_ACID）はこの couple で引くので、
   1つの対に順位が二重に付くことがない。テストで次を機械検証する:
     ・couple の両側が SPECIES にあること
     ・酸化の式なら「還元型が左辺・酸化型が右辺」、還元の式ならその逆にあること
     ・同じ couple を持つ式どうしは kind が違うこと（同じ向きの重複が無い） */
const HALF_REACTIONS = {
  "Zn_ox":  { disp: "Zn → Zn²⁺ ＋ 2e⁻", kind: "oxidation", couple: "Zn^2+/Zn",
              left: [{ sp: "Zn", n: 1 }], right: [{ sp: "Zn^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Cu_ox":  { disp: "Cu → Cu²⁺ ＋ 2e⁻", kind: "oxidation", couple: "Cu^2+/Cu",
              left: [{ sp: "Cu", n: 1 }], right: [{ sp: "Cu^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Cu_red": { disp: "Cu²⁺ ＋ 2e⁻ → Cu", kind: "reduction", couple: "Cu^2+/Cu",
              left: [{ sp: "Cu^2+", n: 1 }, { sp: "e-", n: 2 }], right: [{ sp: "Cu", n: 1 }] },
  "Ag_red": { disp: "Ag⁺ ＋ e⁻ → Ag", kind: "reduction", couple: "Ag+/Ag",
              left: [{ sp: "Ag+", n: 1 }, { sp: "e-", n: 1 }], right: [{ sp: "Ag", n: 1 }] },
  "H_red":  { disp: "2H⁺ ＋ 2e⁻ → H₂", kind: "reduction", couple: "H+/H2",
              left: [{ sp: "H+", n: 2 }, { sp: "e-", n: 2 }], right: [{ sp: "H2", n: 1 }] },
  "Mg_ox":  { disp: "Mg → Mg²⁺ ＋ 2e⁻", kind: "oxidation", couple: "Mg^2+/Mg",
              left: [{ sp: "Mg", n: 1 }], right: [{ sp: "Mg^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Fe_ox":  { disp: "Fe → Fe²⁺ ＋ 2e⁻", kind: "oxidation", couple: "Fe^2+/Fe",
              left: [{ sp: "Fe", n: 1 }], right: [{ sp: "Fe^2+", n: 1 }, { sp: "e-", n: 2 }] },
  "Al_ox":  { disp: "Al → Al³⁺ ＋ 3e⁻", kind: "oxidation", couple: "Al^3+/Al",
              left: [{ sp: "Al", n: 1 }], right: [{ sp: "Al^3+", n: 1 }, { sp: "e-", n: 3 }] },
  // 溶液中の酸化還元（DESIGN_redox.md「溶液中の酸化還元」。酸化剤側に H⁺・H₂O が入る）
  "MnO4_red":  { disp: "MnO₄⁻ ＋ 8H⁺ ＋ 5e⁻ → Mn²⁺ ＋ 4H₂O", kind: "reduction", couple: "MnO4-/Mn^2+",
                 left: [{ sp: "MnO4-", n: 1 }, { sp: "H+", n: 8 }, { sp: "e-", n: 5 }],
                 right: [{ sp: "Mn^2+", n: 1 }, { sp: "H2O", n: 4 }] },
  /* 同じ MnO₄⁻ でも、中性・塩基性では**行き先が変わる**（M6-D。DESIGN_redox_matching.md §2-4）。
     「H⁺ が足りないから反応しない」のではない ＝ 酸化剤としてはたらくことは変わらず、
     受け取る e⁻ が5個から3個になり、Mn²⁺ ではなく黒褐色の MnO₂ になる。
     酸性の式（MnO4_red）とは**別の対**（MnO4-/MnO2）なので、condition.html の
     「両辺に OH⁻ を足して書き換える」では導けない（あちらは同じ酸化還元の書き換えだけを扱う）。 */
  "MnO4_red_neutral": { disp: "MnO₄⁻ ＋ 2H₂O ＋ 3e⁻ → MnO₂ ＋ 4OH⁻", kind: "reduction", couple: "MnO4-/MnO2",
                 left: [{ sp: "MnO4-", n: 1 }, { sp: "H2O", n: 2 }, { sp: "e-", n: 3 }],
                 right: [{ sp: "MnO2", n: 1 }, { sp: "OH-", n: 4 }] },
  "Cr2O7_red": { disp: "Cr₂O₇²⁻ ＋ 14H⁺ ＋ 6e⁻ → 2Cr³⁺ ＋ 7H₂O", kind: "reduction", couple: "Cr2O7^2-/Cr^3+",
                 left: [{ sp: "Cr2O7^2-", n: 1 }, { sp: "H+", n: 14 }, { sp: "e-", n: 6 }],
                 right: [{ sp: "Cr^3+", n: 2 }, { sp: "H2O", n: 7 }] },
  "Fe2_ox":    { disp: "Fe²⁺ → Fe³⁺ ＋ e⁻", kind: "oxidation", couple: "Fe^3+/Fe^2+",
                 left: [{ sp: "Fe^2+", n: 1 }], right: [{ sp: "Fe^3+", n: 1 }, { sp: "e-", n: 1 }] },
  /* 硝酸は「酸」と「酸化剤」の二役。還元されるのは NO₃⁻ で、H⁺ も一緒に消費する。
     希硝酸なら N は +5→+2（NO）、濃硝酸なら +5→+4（NO₂）で、必要な e⁻ と H⁺ の数が変わる。 */
  "NO3_red":      { disp: "NO₃⁻ ＋ 4H⁺ ＋ 3e⁻ → NO ＋ 2H₂O", kind: "reduction", couple: "NO3-/NO",
                 left: [{ sp: "NO3-", n: 1 }, { sp: "H+", n: 4 }, { sp: "e-", n: 3 }],
                 right: [{ sp: "NO", n: 1 }, { sp: "H2O", n: 2 }] },
  "NO3_red_conc": { disp: "NO₃⁻ ＋ 2H⁺ ＋ e⁻ → NO₂ ＋ H₂O", kind: "reduction", couple: "NO3-/NO2",
                 left: [{ sp: "NO3-", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 1 }],
                 right: [{ sp: "NO2", n: 1 }, { sp: "H2O", n: 1 }] },
  /* 液性の切り替え（酸性条件 ⇄ 塩基性条件）で使う。どれも酸性条件の書き方 */
  "H2O_ox":    { disp: "2H₂O → O₂ ＋ 4H⁺ ＋ 4e⁻", kind: "oxidation", couple: "O2/H2O",
                 left: [{ sp: "H2O", n: 2 }], right: [{ sp: "O2", n: 1 }, { sp: "H+", n: 4 }, { sp: "e-", n: 4 }] },
  /* オゾンは O 3個のうち**1個だけ**が還元されて H₂O になり、残り2個は O₂ のまま。
     酸化数を原子ごとに扱うようになって初めて正しく数えられる（Δ＝−2＝e⁻ 2個）。 */
  /* 有機の酸化。無機と同じく「e⁻ を出す」半反応式として書ける。
     変わるのは**官能基のついた炭素1個だけ**で、他の炭素の酸化数は動かない。
     ここが原子ごとの酸化数を持つようにした甲斐のあるところ。 */
  "EtOH_ox":   { disp: "CH₃CH₂OH → CH₃CHO ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "CH3CHO/C2H5OH",
                 left: [{ sp: "C2H5OH", n: 1 }],
                 right: [{ sp: "CH3CHO", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  "MeCHO_ox":  { disp: "CH₃CHO ＋ H₂O → CH₃COOH ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "CH3COOH/CH3CHO",
                 left: [{ sp: "CH3CHO", n: 1 }, { sp: "H2O", n: 1 }],
                 right: [{ sp: "CH3COOH", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  "iPrOH_ox":  { disp: "CH₃CH(OH)CH₃ → CH₃COCH₃ ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "CH3COCH3/C3H7OH",
                 left: [{ sp: "C3H7OH", n: 1 }],
                 right: [{ sp: "CH3COCH3", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  /* ヨードホルム反応。**まずメチル基を CH₃⁺ として切り離し**、それを半反応式の出発点にする。
     切り離した炭素は −2（分子の中では −3。C–C の電子対を置いていくぶん1つ上がる）。
     CHI₃ の炭素は +2 なので Δ＝+4、つまり e⁻ 4個 ＝ I₂ 2個 でぴったり閉じる。
     ヨウ素は「酸化剤（I₂ → I⁻）」と「置換基として入る I」の二役なので、
     酸化の側はヨウ素源を **I⁻** で受ける。足し合わせると I⁻ が打ち消え、
     CH₃⁺ ＋ 2I₂ → CHI₃ ＋ 2H⁺ ＋ I⁻ になる（硝酸の NO₃⁻ と同じ媒介役）。 */
  "iodoform_ox": { disp: "CH₃⁺ ＋ 3I⁻ → CHI₃ ＋ 2H⁺ ＋ 4e⁻", kind: "oxidation", couple: "CHI3/CH3+",
                 left: [{ sp: "CH3+", n: 1 }, { sp: "I-", n: 3 }],
                 right: [{ sp: "CHI3", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 4 }] },
  /* 切り離した「残りの断片」も、このあと +2 だけ酸化されてカルボン酸イオンになる。
     メチル側の I₂ 2個とこの1個を合わせて **I₂ 3個** ＝ 教科書の全体式と一致する。 */
  "acylRest_ox":  { disp: "CH₃CO⁻ ＋ H₂O → CH₃COO⁻ ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "CH3COO-/CH3CO-",
                 left: [{ sp: "CH3CO-", n: 1 }, { sp: "H2O", n: 1 }],
                 right: [{ sp: "CH3COO-", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  "formylRest_ox": { disp: "CHO⁻ ＋ H₂O → HCOO⁻ ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "HCOO-/CHO-",
                 left: [{ sp: "CHO-", n: 1 }, { sp: "H2O", n: 1 }],
                 right: [{ sp: "HCOO-", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  "I2_red":    { disp: "I₂ ＋ 2e⁻ → 2I⁻", kind: "reduction", couple: "I2/I-",
                 left: [{ sp: "I2", n: 1 }, { sp: "e-", n: 2 }], right: [{ sp: "I-", n: 2 }] },
  "O3_red":    { disp: "O₃ ＋ 2H⁺ ＋ 2e⁻ → O₂ ＋ H₂O", kind: "reduction", couple: "O3/O2",
                 left: [{ sp: "O3", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }],
                 right: [{ sp: "O2", n: 1 }, { sp: "H2O", n: 1 }] },
  "H2O2_red":  { disp: "H₂O₂ ＋ 2H⁺ ＋ 2e⁻ → 2H₂O", kind: "reduction", couple: "H2O2/H2O",
                 left: [{ sp: "H2O2", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }],
                 right: [{ sp: "H2O", n: 2 }] },
  "oxalate_ox": { disp: "C₂O₄²⁻ → 2CO₂ ＋ 2e⁻", kind: "oxidation", couple: "CO2/C2O4^2-",
                 left: [{ sp: "C2O4^2-", n: 1 }], right: [{ sp: "CO2", n: 2 }, { sp: "e-", n: 2 }] },
  /* ↓2本は DESIGN_redox.md の表に載っていたのに未実装だったぶん（M6-A で追加）。
     どちらも「同じ物質が相手しだいで逆の役をする」ことを見せるための式。
       I_ox    … I2_red の裏返し。KI を還元剤として選べるようになる
       H2O2_ox … H₂O₂ が**還元剤**としてはたらくときの式。H2O2_red と対で、
                 過酸化水素が梯子に2回出てくる（O2/H2O2 と H2O2/H2O）ことの実体 */
  /* 熱濃硫酸（M6-F。DESIGN_redox_matching.md §9-3・qa/KNOWLEDGE_CAVEATS.md H-2）。
     **札は必ず「熱濃硫酸」**にする。酸化作用を示すのは熱くて濃いときだけで、
     冷濃硫酸は Al・Fe・Ni と不動態をつくる。「濃硫酸」という札にすると、この2つが
     一緒くたになって事故る。

     式を **H₂SO₄**（分子）で書くのが要点。うすい硫酸の SO₄²⁻ は銅を溶かさないので、
     ここを SO₄²⁻ ＋ 4H⁺ ＋ 2e⁻ → SO₂ ＋ 2H₂O と書くと**別の話に化ける**
     （教科書の「主な酸化剤」の表も、濃硫酸のときだけ分子の形で書く）。
     S は +6 → +4 で Δ＝−2 ＝ e⁻ 2個。左辺の 2H⁺ はもう1分子の硫酸が出すぶんで、
     足し合わせると Cu ＋ 2H₂SO₄ → CuSO₄ ＋ SO₂ ＋ 2H₂O になる。 */
  "H2SO4_hot_red": { disp: "H₂SO₄ ＋ 2H⁺ ＋ 2e⁻ → SO₂ ＋ 2H₂O", kind: "reduction", couple: "H2SO4/SO2",
                 left: [{ sp: "H2SO4", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }],
                 right: [{ sp: "SO2", n: 1 }, { sp: "H2O", n: 2 }] },
  /* 硫化水素（M6-F。§9-3）。S は **−2 で下限**なので、H₂S は還元剤にしかなれない
     （同じ硫黄でも SO₂ は +4 で上にも下にも動ける ＝ 二役になれる。この差が見どころ）。
     酸化されると単体の硫黄が白く濁って出てくる。S は −2 → 0 で Δ＝+2 ＝ e⁻ 2個。 */
  "H2S_ox":    { disp: "H₂S → S ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "S/H2S",
                 left: [{ sp: "H2S", n: 1 }],
                 right: [{ sp: "S", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },
  /* 二酸化硫黄の**二役**（M6-F。§9-3）。S が +4 ＝ 上（+6）にも下（0）にも動けるので、
     相手しだいで酸化剤にも還元剤にもなる。H₂O₂ と並ぶ「同じ物質が梯子に2回出る」代表で、
     このモードの見どころ。ただし**出番の多さは段違い**で、
     酸化剤としてはたらく相手は高校の範囲では実質 H₂S だけ（教科書もそう書く）。
       還元剤として … SO₂ ＋ 2H₂O → SO₄²⁻ ＋ 4H⁺ ＋ 2e⁻（S: +4 → +6・Δ＝+2）
       酸化剤として … SO₂ ＋ 4H⁺ ＋ 4e⁻ → S ＋ 2H₂O （S: +4 → 0・Δ＝−4）
     H₂S と足すと 2H₂S ＋ SO₂ → 3S ＋ 2H₂O（H⁺ が打ち消えて、教科書の式そのものになる）。 */
  "SO2_ox":    { disp: "SO₂ ＋ 2H₂O → SO₄²⁻ ＋ 4H⁺ ＋ 2e⁻", kind: "oxidation", couple: "SO4^2-/SO2",
                 left: [{ sp: "SO2", n: 1 }, { sp: "H2O", n: 2 }],
                 right: [{ sp: "SO4^2-", n: 1 }, { sp: "H+", n: 4 }, { sp: "e-", n: 2 }] },
  "SO2_red":   { disp: "SO₂ ＋ 4H⁺ ＋ 4e⁻ → S ＋ 2H₂O", kind: "reduction", couple: "SO2/S",
                 left: [{ sp: "SO2", n: 1 }, { sp: "H+", n: 4 }, { sp: "e-", n: 4 }],
                 right: [{ sp: "S", n: 1 }, { sp: "H2O", n: 2 }] },
  "I_ox":      { disp: "2I⁻ → I₂ ＋ 2e⁻", kind: "oxidation", couple: "I2/I-",
                 left: [{ sp: "I-", n: 2 }], right: [{ sp: "I2", n: 1 }, { sp: "e-", n: 2 }] },
  "H2O2_ox":   { disp: "H₂O₂ → O₂ ＋ 2H⁺ ＋ 2e⁻", kind: "oxidation", couple: "O2/H2O2",
                 left: [{ sp: "H2O2", n: 1 }],
                 right: [{ sp: "O2", n: 1 }, { sp: "H+", n: 2 }, { sp: "e-", n: 2 }] },

  /* 電気分解の陽極（B3・実装の刻み5）。**梯子（REDOX_LADDER_ACID）には載せない**。
     電気分解は電源が e⁻ を押し込む反応で、起こるかどうかは酸化還元の強さ比べ（梯子）では
     決まらないから——載せると、自由組み立てモードで「Cl⁻ は誰と反応するか」を
     梯子から答えてしまう。梯子は「載っている対に半反応式があること」しか要求しない。 */
  "Cl_ox":     { disp: "2Cl⁻ → Cl₂ ＋ 2e⁻", kind: "oxidation", couple: "Cl2/Cl-",
                 left: [{ sp: "Cl-", n: 2 }], right: [{ sp: "Cl2", n: 1 }, { sp: "e-", n: 2 }] },
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
  "MnO2":     { Mn: 4, O: -2 },
  "Cr2O7^2-": { Cr: 6, O: -2 },
  "Cr^3+":    { Cr: 3 },
  "Fe^3+":    { Fe: 3 },
  "H2O":      { H: 1, O: -2 },
  "C2O4^2-":  { C: 3, O: -2 },
  "CO2":      { C: 4, O: -2 },
  "NO3-":     { N: 5, O: -2 },
  "NO":       { N: 2, O: -2 },
  "NO2":      { N: 4, O: -2 },
  // 液性の切り替えで使う種。H₂O₂ の O が −1 なのは過酸化物の例外（データで表現する）
  "O2":       { O: 0 },
  "O3":       { O: 0 },
  /* 有機。同じ C でも位置で酸化数が違うので原子ごとに持つ（at は disp の中の位置）。
     C–C は 0、C–H は −1、C–O は +1（二重結合は2本ぶん）で数えた値 */
  "C2H5OH":   { C: [{ ox: -3, at: 0 }, { ox: -1, at: 3 }], H: 1, O: -2 },
  "CH3CHO":   { C: [{ ox: -3, at: 0 }, { ox: 1, at: 3 }], H: 1, O: -2 },
  "CH3COOH":  { C: [{ ox: -3, at: 0 }, { ox: 3, at: 3 }], H: 1, O: -2 },
  "C3H7OH":   { C: [{ ox: -3, at: 0 }, { ox: 0, at: 3 }, { ox: -3, at: 9 }], H: 1, O: -2 },
  "CH3COCH3": { C: [{ ox: -3, at: 0 }, { ox: 2, at: 3 }, { ox: -3, at: 5 }], H: 1, O: -2 },
  // ヨードホルム反応。C–I は I 側が −1（C は +1／結合）。単体の I₂ だけ 0
  "I2":       { I: 0 },
  "I-":       { I: -1 },
  // 電気分解（B3）。塩化物イオンは −1、単体の塩素は 0
  "Cl2":      { Cl: 0 },
  "Cl-":      { Cl: -1 },
  // ↓2種は現在未使用（SPECIES 側の注記どおり、将来の段階表示用に組で残す）
  "CH3COCI3": { C: [{ ox: -3, at: 0 }, { ox: 2, at: 3 }, { ox: 3, at: 5 }], H: 1, I: -1, O: -2 },
  "CI3CHO":   { C: [{ ox: 3, at: 0 }, { ox: 1, at: 3 }], H: 1, I: -1, O: -2 },
  "CHI3":     { C: 2, H: 1, I: -1 },
  "CH3COO-":  { C: [{ ox: -3, at: 0 }, { ox: 3, at: 3 }], H: 1, O: -2 },
  // 切り離した断片。CH₃⁺ の炭素が −2 なのが、この見方の出発点
  "CH3+":     { C: -2, H: 1 },
  "CH3CO-":   { C: [{ ox: -3, at: 0 }, { ox: 1, at: 3 }], H: 1, O: -2 },
  "CHO-":     { C: 0, H: 1, O: -2 },
  "HCOO-":    { C: 2, H: 1, O: -2 },
  "H2O2":     { H: 1, O: -1 },
  "OH-":      { O: -2, H: 1 },
  // 硫黄まわり（M6-F）。熱濃硫酸の S は +6、二酸化硫黄の S は +4、硫化水素の S は −2（下限）
  "H2SO4":    { H: 1, S: 6, O: -2 },
  "SO2":      { S: 4, O: -2 },
  "H2S":      { H: 1, S: -2 },
  "S":        { S: 0 },
  "SO4^2-":   { S: 6, O: -2 },
};

/* ---- 酸化数は「原子1個ずつ」で扱う ----
   OXIDATION[種][元素] は次の2つの書き方を許す。
     数値      … その元素の原子はすべて同じ酸化数（無機のほとんど）
     配列      … 原子ごとに違う酸化数。[{ ox, at }] で、並び順は構造式の左から。
                  at は disp の中でその原子を表す文字の位置（酸化数をその真下に出すため）
   有機では同じ C でも位置によって酸化数が違う（エタノールの C は −3 と −1）ので、
   平均値ではなく原子ごとに持たないと「どの炭素が酸化されたか」を言えない。 */

/* 種の元素 el について、原子1個ずつの酸化数を並べて返す */
function oxAtomList(sp, el) {
  const ox = OXIDATION[sp];
  if (!ox || ox[el] === undefined) return [];
  const v = ox[el];
  if (Array.isArray(v)) return v.map((a) => a.ox);
  return Array.from({ length: SPECIES[sp].atoms[el] || 0 }, () => v);
}

/* 種の酸化数の合計（電荷と一致するはず。テストで機械検証する） */
function oxSum(sp) {
  const ox = OXIDATION[sp];
  let sum = 0;
  for (const el of Object.keys(SPECIES[sp].atoms)) {
    const v = ox[el];
    if (v === undefined) continue;
    sum += Array.isArray(v) ? v.reduce((a, o) => a + o.ox, 0) : v * SPECIES[sp].atoms[el];
  }
  return sum;
}

/* 半反応式の中で酸化数が変化した原子を返す（[{ el, from, to, count }]）。

   左辺・右辺それぞれについて、元素ごとに**原子1個ずつの酸化数を全部並べた多重集合**を作り、
   同じ値どうしを打ち消す。残ったものが「変化した原子」。
   平均や代表値で比べていたころは、O₃ → O₂ ＋ H₂O のように
   **同じ元素の一部の原子だけが変化する**反応を正しく扱えなかった。
   多重集合の差なので項の並び順にも依存しない。 */
/* 項の一覧 → 元素ごとの「原子1個ずつの酸化数リスト」（係数ぶん繰り返す） */
function oxAtomLists(terms) {
  const m = {};
  for (const t of terms) {
    if (t.sp === "e-" || !OXIDATION[t.sp]) continue;
    for (const el of Object.keys(SPECIES[t.sp].atoms)) {
      const list = oxAtomList(t.sp, el);
      if (!list.length) continue;
      if (!m[el]) m[el] = [];
      for (let k = 0; k < t.n; k++) m[el].push(...list);
    }
  }
  return m;
}

function oxChangeOfHalf(hr) {
  const L = oxAtomLists(hr.left), R = oxAtomLists(hr.right);
  const changes = [];
  for (const el of Object.keys(L)) {
    if (!R[el]) continue;
    const a = L[el].slice().sort((x, y) => x - y);
    const b = R[el].slice().sort((x, y) => x - y);
    const restL = [], restR = [];
    let i = 0, j = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; }
      else if (a[i] < b[j]) restL.push(a[i++]);
      else restR.push(b[j++]);
    }
    while (i < a.length) restL.push(a[i++]);
    while (j < b.length) restR.push(b[j++]);
    if (!restL.length && !restR.length) continue;
    const uniq = (arr) => [...new Set(arr)];
    const fu = uniq(restL), tu = uniq(restR);
    const c = { el, from: fu[0], to: tu[0], count: restL.length };
    // 1種類の変化にまとまらない＝データの誤りか、この図法では扱えない反応。テストで弾く
    if (fu.length !== 1 || tu.length !== 1 || restL.length !== restR.length) c.ambiguous = true;
    changes.push(c);
  }
  return changes;
}

/* 有色の化学種の色（溶液中の酸化還元アニメの色変化用。見た目専用だが検証はする）。
   ここに無い種は無色（既定の淡色）として扱う。 */
const SPECIES_COLOR = {
  "MnO4-":    "#7b2fb0", // 赤紫（過マンガン酸）
  "Mn^2+":    "#f0e6f3", // ほぼ無色（淡い）
  "MnO2":     "#4a3226", // 黒褐色（中性・塩基性での行き先。水にとけない）
  "Cr2O7^2-": "#e0842a", // 橙（二クロム酸）
  "Cr^3+":    "#3f9d5a", // 緑
  "Fe^2+":    "#a9d3a9", // 淡緑
  "Fe^3+":    "#c79a3a", // 黄褐
};

/* ★ bottles（＝化学反応式まで組み立てる段）を持たせないステージについて（v182・【A】）★

   ユーザーの申し立て（2026-08-18）:「**金属樹では通常イオン反応式で済ませるので
   ④ではこの機能は不要です**」「具体的には酸化還元のステージ１，２，４は化学反応式が要らない」。

   r1・r2・r4 は金属樹（＝金属が析出する）で、教科書もイオン反応式で止める:
       Zn ＋ Cu²⁺ → Zn²⁺ ＋ Cu
   ここで化学反応式まで書かせると、SO₄²⁻ を連れ回すだけで学ぶことが増えない。

   **r3（亜鉛 × 塩酸）だけは残す。** 金属樹でも電池でもなく、気体発生なので
   教科書も Zn ＋ 2HCl → ZnCl₂ ＋ H₂ と化学反応式で書く（量的計算にも使う。
   ratio 側にも 2Al ＋ 3H₂SO₄ が化学反応式で入っている）。
   ついでに⑤の数入力がいちばん短い（Zn 1本・HCl 2本）ので、数入力の入門例にもなる。 */
const REDOX_STAGES = [
  {
    id: "r1", title: "亜鉛 × 銅(Ⅱ)イオン",
    ox: "Zn_ox", red: "Cu_red", answer: [1, 1],
    // bottles を持たない ＝ 金属樹はイオン反応式で済ませる（上の★）
    intro: "硫酸銅水溶液に亜鉛板を入れると、板に赤い銅が付き、亜鉛が溶けていく。電子の動きを見よう。",
  },
  {
    id: "r2", title: "銅 × 銀イオン（銀樹）",
    ox: "Cu_ox", red: "Ag_red", answer: [1, 2],
    // bottles を持たない（金属樹）
    intro: "硝酸銀水溶液に銅線を入れると銀樹が育つ。Cu は e⁻ を2個出すが、Ag⁺ は1個ずつしか受け取れない。",
  },
  {
    id: "r3", title: "亜鉛 × 塩酸（水素発生）",
    ox: "Zn_ox", red: "H_red", answer: [1, 1],
    bottles: ["Zn", "HCl"],
    intro: "亜鉛に塩酸を注ぐと H₂ の泡が出る。e⁻ を受け取るのは H⁺ が2個で1組。",
  },
  {
    id: "r4", title: "アルミニウム × 銅(Ⅱ)イオン（2:3）",
    ox: "Al_ox", red: "Cu_red", answer: [2, 3],
    // bottles を持たない（金属樹）
    intro: "Al は e⁻ を3個出し、Cu²⁺ は2個ずつ受け取る。3と2の最小公倍数、e⁻ 6個でそろえよう。",
  },
  {
    id: "rs1", title: "過マンガン酸カリウム × 鉄(Ⅱ)（溶液中）",
    ox: "Fe2_ox", red: "MnO4_red", answer: [5, 1], mode: "solution",
    bottles: ["KMnO4", "FeSO4", "H2SO4"],
    intro: "板は無し。溶液中で Fe²⁺ が e⁻ を出して Fe³⁺ に、MnO₄⁻ が H⁺ と e⁻ を受け取って Mn²⁺ になる。赤紫が消えるまで。",
  },
  {
    id: "rs2", title: "二クロム酸カリウム × 鉄(Ⅱ)（溶液中）",
    ox: "Fe2_ox", red: "Cr2O7_red", answer: [6, 1], mode: "solution",
    bottles: ["K2Cr2O7", "FeSO4", "H2SO4"],
    intro: "Cr₂O₇²⁻ は Cr が2個で e⁻ を6個受け取る。Fe²⁺ を何個そろえる？ 橙色が緑色に変わる。",
  },
  {
    id: "rs3", title: "過マンガン酸カリウム × シュウ酸（溶液中）",
    ox: "oxalate_ox", red: "MnO4_red", answer: [5, 2], mode: "solution",
    /* 【G】v183 で化学反応式まで組めるようにした。**H⁺ が2本の瓶から出る**初めての例:
         16 H⁺ ＝ H₂C₂O₄ 5本ぶんの 10個 ＋ H₂SO₄ 3本ぶんの 6個
       ユーザーの言葉「シュウ酸は弱酸なので硫酸を加える必要がある」がここで数になる ——
       シュウ酸だけでは 10個 しか出ず、6個 足りないから強酸を足す。
       前レーンはこれを「別の話が混ざる」として見送ったが、**混ぜるのではなく見せ場**にした。 */
    bottles: ["KMnO4", "H2C2O4", "H2SO4"],
    /* 提示形の注記（J-1・2026-08-05 ユーザー判断）: シュウ酸は弱酸なので、高校の模範解答では
       イオン反応式でも H₂C₂O₄ 分子のまま書くのが通例。現行の C₂O₄²⁻ 形でも保存は成立して
       誤りではないため、ここでは**呼称だけ**「シュウ酸イオン」に正した。
       提示形を H₂C₂O₄ にそろえるかは独立タスクとして別途判断する。 */
    intro: "シュウ酸イオン C₂O₄²⁻ は e⁻ を2個出して CO₂ の泡になる。MnO₄⁻ は5個受け取る。e⁻ 10個でそろえよう。紫が消え、泡が出る。",
  },
  /* 有機の酸化還元。無機と同じく「e⁻ を出す／受け取る」で書けることを見せる。
     アルコールの酸化は「水素が取れる」と習うが、正体は**官能基のついた炭素1個の酸化数が
     上がる**こと。第1級は アルデヒド → カルボン酸 と2段階、第2級は ケトンで止まる。 */
  /* ro 系の分子反応式（v134・Gemini 提案の採用。係数は独立に検算済み）。
     傍観イオンは2種類ある: K⁺ は K₂Cr₂O₇ が連れてくる2個で数が決まっている（fixed）ので、
     ステッパーで探すのは SO₄²⁻ の数（=H₂SO₄ の係数）だけ。
     右辺では 2Cr³⁺＋3SO₄²⁻→Cr₂(SO₄)₃、残った 2K⁺＋SO₄²⁻→K₂SO₄ に組む。 */
  {
    id: "ro1", title: "エタノールの酸化①（→ アセトアルデヒド）",
    ox: "EtOH_ox", red: "Cr2O7_red", answer: [3, 1], mode: "solution",
    bottles: ["C2H5OH", "K2Cr2O7", "H2SO4"],
    molecularEq: {
      reactants: ["C2H5OH", "K2Cr2O7", "H2SO4"],
      products: ["CH3CHO", "Cr2(SO4)3", "K2SO4", "H2O"],
      answer: [3, 1, 4, 3, 1, 1, 7],
      spectator: "SO4^2-",
      fixed: [{ side: "left", sp: "K+", n: 2 }, { side: "right", sp: "K+", n: 2 }],
      fixedNote: "（K⁺ 2個は K₂Cr₂O₇ が連れてきたぶん。数を探すのは SO₄²⁻ だけ）",
      join: [
        { side: "left",  ion: "Cr2O7^2-", withSp: "K+", withN: 2, per: 0, to: "K2Cr2O7" },
        { side: "left",  ion: "H+",    ionN: 2, per: 1, to: "H2SO4" },
        { side: "right", ion: "Cr^3+", ionN: 2, per: 3, to: "Cr2(SO4)3" },
        { side: "right", ion: "K+",    ionN: 2, per: 1, to: "K2SO4" },
      ],
    },
    intro: "二クロム酸カリウムの酸性溶液にエタノールを加えると、橙色が緑色に変わる。OH のついた炭素だけが −1 から +1 に上がる。倍率をそろえたら、仕上げに傍観イオン（K⁺・SO₄²⁻）を戻して完全な化学反応式へ。",
  },
  {
    id: "ro2", title: "エタノールの酸化②（アセトアルデヒド → 酢酸）",
    ox: "MeCHO_ox", red: "Cr2O7_red", answer: [3, 1], mode: "solution",
    bottles: ["CH3CHO", "K2Cr2O7", "H2SO4"],
    molecularEq: {
      reactants: ["CH3CHO", "K2Cr2O7", "H2SO4"],
      products: ["CH3COOH", "Cr2(SO4)3", "K2SO4", "H2O"],
      answer: [3, 1, 4, 3, 1, 1, 4],
      spectator: "SO4^2-",
      fixed: [{ side: "left", sp: "K+", n: 2 }, { side: "right", sp: "K+", n: 2 }],
      fixedNote: "（K⁺ 2個は K₂Cr₂O₇ が連れてきたぶん。数を探すのは SO₄²⁻ だけ）",
      join: [
        { side: "left",  ion: "Cr2O7^2-", withSp: "K+", withN: 2, per: 0, to: "K2Cr2O7" },
        { side: "left",  ion: "H+",    ionN: 2, per: 1, to: "H2SO4" },
        { side: "right", ion: "Cr^3+", ionN: 2, per: 3, to: "Cr2(SO4)3" },
        { side: "right", ion: "K+",    ionN: 2, per: 1, to: "K2SO4" },
      ],
    },
    intro: "酸化はもう一段進む。同じ炭素が +1 から +3 へ。水が1個必要なのは、増える O をどこかから持ってこないといけないから。仕上げは①と同じく、傍観イオンを戻して化学反応式に。",
  },
  {
    id: "ro3", title: "2-プロパノールの酸化（→ アセトン。ここで止まる）",
    ox: "iPrOH_ox", red: "Cr2O7_red", answer: [3, 1], mode: "solution",
    bottles: ["C3H7OH", "K2Cr2O7", "H2SO4"],
    molecularEq: {
      reactants: ["C3H7OH", "K2Cr2O7", "H2SO4"],
      products: ["CH3COCH3", "Cr2(SO4)3", "K2SO4", "H2O"],
      answer: [3, 1, 4, 3, 1, 1, 7],
      spectator: "SO4^2-",
      fixed: [{ side: "left", sp: "K+", n: 2 }, { side: "right", sp: "K+", n: 2 }],
      fixedNote: "（K⁺ 2個は K₂Cr₂O₇ が連れてきたぶん。数を探すのは SO₄²⁻ だけ）",
      join: [
        { side: "left",  ion: "Cr2O7^2-", withSp: "K+", withN: 2, per: 0, to: "K2Cr2O7" },
        { side: "left",  ion: "H+",    ionN: 2, per: 1, to: "H2SO4" },
        { side: "right", ion: "Cr^3+", ionN: 2, per: 3, to: "Cr2(SO4)3" },
        { side: "right", ion: "K+",    ionN: 2, per: 1, to: "K2SO4" },
      ],
    },
    intro: "第2級アルコールは 0 から +2 に上がってケトンになり、そこで止まる。その炭素にはもう H が残っていないから。ここでも傍観イオンを戻せば化学反応式が完成する。",
  },
  /* ヨードホルム反応。ご指示の見方: **反応物のメチル基を切断して CH₃⁺ を生じさせ、それを
     半反応式とする**。アルコールから入る場合は2段階で、まず ro1 でカルボニル化合物にしてから。
     アセトンでもアセトアルデヒドでも、切り出したあとの半反応式は**同じ1本**になる。 */
  {
    id: "ri1", title: "ヨードホルム反応（アセトンから）",
    ox: "iodoform_ox", red: "I2_red", answer: [1, 2], mode: "solution",
    cleavage: "acetone",
    intro: "先にメチル基を CH₃⁺ として切り離す（上の段）。その炭素は −2 で、CHI₃ では +2。Δ は +4 なので e⁻ は4個。I₂ は何個要る？",
  },
  {
    id: "ri2", title: "ヨードホルム反応（エタノール → アセトアルデヒドから）",
    ox: "iodoform_ox", red: "I2_red", answer: [1, 2], mode: "solution",
    cleavage: "acetald",
    intro: "エタノールは、まず ro1 でアセトアルデヒドにしてからこの段に入る。切り出す CH₃⁺ は同じなので、半反応式もアセトンとまったく同じ。",
  },
  {
    /* 銅は水素よりイオン化傾向が小さいので、塩酸や希硫酸には溶けない（ステージ3の亜鉛と対照）。
       それでも硝酸には溶ける — 溶かしているのは H⁺ ではなく**酸化剤としての NO₃⁻** だから。
       希と濃で出てくる気体が違う（NO と NO₂）のは、N の酸化数の落ち方が違うため。 */
    id: "rn1", title: "銅 × 希硝酸（無色の NO が発生）",
    ox: "Cu_ox", red: "NO3_red", answer: [3, 2],
    bottles: ["Cu", "HNO3"],
    /* イオン反応式のあと、傍観の NO₃⁻ を戻して分子反応式にする段。
       acid = 酸と酸化剤を兼ねる項（HNO₃）。この項の係数は
       「還元されるぶん」＋「塩になるぶん」の合計なので、電子だけ合わせても足りない。 */
    molecularEq: {
      reactants: ["Cu", "HNO3"], products: ["Cu(NO3)2", "NO", "H2O"], answer: [3, 8, 3, 2, 4],
      acid: 1, reduced: 3, salt: 2, spectatorPerSalt: 2,
      /* 筆算の4行目「両辺に足す傍観イオン」。join は、その傍観イオンと組んで
         分子・塩の姿に戻る相手（左辺の H⁺ は HNO₃ に、右辺の Cu²⁺ は Cu(NO₃)₂ に）。 */
      spectator: "NO3-",
      join: [
        { side: "left",  ion: "H+",    per: 1, to: "HNO3" },
        { side: "right", ion: "Cu^2+", per: 2, to: "Cu(NO3)2" },
      ],
    },
    intro: "銅は塩酸には溶けないのに、希硝酸には溶ける。溶かしているのは H⁺ ではなく NO₃⁻ のほう。Cu は e⁻ を2個出し、NO₃⁻ は3個受け取る。何個ずつそろえる？",
  },
  {
    id: "rn2", title: "銅 × 濃硝酸（赤褐色の NO₂ が発生）",
    ox: "Cu_ox", red: "NO3_red_conc", answer: [1, 2],
    bottles: ["Cu", "HNO3"],
    molecularEq: {
      reactants: ["Cu", "HNO3"], products: ["Cu(NO3)2", "NO2", "H2O"], answer: [1, 4, 1, 2, 2],
      acid: 1, reduced: 3, salt: 2, spectatorPerSalt: 2,
      spectator: "NO3-",
      join: [
        { side: "left",  ion: "H+",    per: 1, to: "HNO3" },
        { side: "right", ion: "Cu^2+", per: 2, to: "Cu(NO3)2" },
      ],
    },
    intro: "同じ銅と硝酸でも、濃いと赤褐色の NO₂ が出る。濃硝酸では NO₃⁻ が受け取る e⁻ は1個だけ。倍率はどうなる？",
  },
];

/* ================================================================================
   M6-A: 酸化剤×還元剤の組み合わせ判定（DESIGN_redox_matching.md）
   すべて DOM 非依存の純ロジック。画面はまだ無い（M6-B 以降）。

   ★ 用語の落とし穴 ★
   同じ "ox" / "red" が、**2つの意味**で使われている。取り違えると静かに壊れるので、
   この節では変数名を oxidant（酸化剤）/ reductant（還元剤）と書き分ける。

     REDOX_STAGES と composeStage の ox / red … **半反応式の向き**
       ox  = kind:"oxidation" の式（酸化される側 ＝ 中身は**還元剤**）
       red = kind:"reduction" の式（還元される側 ＝ 中身は**酸化剤**）

     REAGENTS の side と matchRedox の引数 … **試薬の役**
       side:"ox"  = 酸化剤（その半反応式は kind:"reduction"）
       side:"red" = 還元剤（その半反応式は kind:"oxidation"）
   ================================================================================ */

/* 酸化還元の梯子（酸性条件）。上にあるものほど「e⁻ を奪う力が強い＝酸化剤として強い」。
   値は**順位であって電位ではない**（10刻みなのは、あとから間に足せるようにするため）。
   同じ値＝この収録範囲では強弱を決めない（＝判定しない）。

   **順位の数値は絶対に画面に出さない**（電位の暗記にすり替わる。DESIGN §2-3・§9-2）。
   デバッグ表示にも出さないこと。

   キーは半反応式の id ではなく**対（couple）**。Cu_ox と Cu_red は向きが違うだけの
   同じ対なので、順位は1つしか持たない。金属の対だけを抜き出すとイオン化傾向そのものに
   なる（IONIZATION_SERIES として下で導出し、テストで並びを固定する）。 */
const REDOX_LADDER_ACID = {
  "O3/O2":          200,  // O₃ ＋ 2H⁺ ＋ 2e⁻ → O₂ ＋ H₂O
  "H2O2/H2O":       190,  // H₂O₂ が**酸化剤**としてはたらくとき
  "MnO4-/Mn^2+":    180,
  "Cr2O7^2-/Cr^3+": 170,
  "O2/H2O":         150,  // H2O_ox の対
  /* 硝酸は希・濃で**順位を分けない**（DESIGN §9-1・ユーザー判断）。
     教科書は「濃のほうが酸化力が強い」と教えるが、それは濃度効果を酸化力と呼んだもので、
     標準電極電位の順序とは逆になる。どちらを採っても片方に嘘をつくので、
     違いは順位ではなく「**生成物が変わる**（NO ⇄ NO₂）」でだけ表す。
     対は生成物が違うので2つに分かれるが、**同じ値**を置くことで「順位を分けない」を表す。 */
  "NO3-/NO":        130,
  "NO3-/NO2":       130,
  "Ag+/Ag":         120,
  "Fe^3+/Fe^2+":    115,
  "O2/H2O2":        110,  // H₂O₂ が**還元剤**としてはたらくとき。同じ物質が梯子に2回出る
  "I2/I-":          100,
  "Cu^2+/Cu":        90,
  /* 二酸化硫黄が**酸化剤**としてはたらくとき（M6-F）。E° でいえば I₂/I⁻ と Cu²⁺/Cu のあいだ。
     ここに置くと「SO₂ は I⁻ から e⁻ を奪えない（順序が逆）」が正しく出る
     ＝ SO₂ と I₂ が出会えば SO₂ のほうが還元剤になる、という向きが梯子から言える。
     金属（Zn・Fe・Cu…）は順位のうえでは下にあるが、教科書が扱う相手ではないので
     試薬の側の pairsWith で「H₂S だけ」に絞る（順位を動かすのではなく言い切る範囲を絞る）。 */
  "SO2/S":           95,
  /* 硫化水素（M6-F）。E° でいえば S/H₂S は H⁺/H₂ と Cu²⁺/Cu のあいだ。
     ここに置くと「H₂S は KMnO₄・K₂Cr₂O₇・O₃・H₂O₂・硝酸・I₂ に酸化される／
     うすい塩酸では酸化されない」が全部そろって出る（どれも教科書どおり）。
     Cu²⁺・Ag⁺ は順位のうえでは進む向きだが、先に硫化物の黒い沈殿ができるので例外表で止める。 */
  "S/H2S":           85,
  /* 二酸化硫黄が**還元剤**としてはたらくとき（M6-F）。E° は +0.17 V で S/H₂S（+0.14 V）と
     ほとんど変わらないので、**同じ 85 に置いて強弱を決めない**（§2-3。差が高校で扱える
     解像度より細かい。しかもこの2つはどちらも酸化の側の対なので、突き合わされる場面が無い）。 */
  "SO4^2-/SO2":      85,
  "H+/H2":           80,  // ここが「イオン化傾向で H より上か下か」の境目
  "Fe^2+/Fe":        60,
  "CO2/C2O4^2-":     55,  // シュウ酸
  "Zn^2+/Zn":        50,
  "Al^3+/Al":        30,
  "Mg^2+/Mg":        10,
};

/* 有機の酸化には高校で扱う順位が存在しないので、梯子に載せず**相手を明示列挙**する。
   キーは酸化される側（kind:"oxidation"）の半反応式 id、値は相手＝酸化剤の半反応式 id。
   ここに無い相手は「反応しない」ではなく **undecided**（順位を持っていないので
   「しない」と言えない。DESIGN §5-3 の4）。
   ヨードホルム系の3本は切り離した断片が出発点で試薬として選べないが、
   ステージ ri1 / ri2 が使うので相手（I₂）を書いておく。 */
const ORGANIC_OXIDANTS = {
  "EtOH_ox":       ["Cr2O7_red", "MnO4_red"],
  "MeCHO_ox":      ["Cr2O7_red", "MnO4_red"],
  "iPrOH_ox":      ["Cr2O7_red", "MnO4_red"],
  "iodoform_ox":   ["I2_red"],
  "acylRest_ox":   ["I2_red"],
  "formylRest_ox": ["I2_red"],
};

/* そのステージが**有機（発展）**か（v182・【F】）。
   ユーザーの指示:「**ステージ８－１２は化学基礎でなく、有機（発展）なので区別する**」。

   **id の一覧を手で書かない**（設計原則「対応表を手で書かない」）。
   有機かどうかは、酸化される側の半反応式が ORGANIC_OXIDANTS に載っているかで決まる
   ＝ 有機の試薬を足せば区別も自動でついてくる。

   ⚠ シュウ酸（rs3・ステージ7）は分子としては有機だが、**ここには入らない**（oxalate_ox は
   梯子に順位を持つので ORGANIC_OXIDANTS に載っていない）。ユーザーの言う 8〜12 と
   ちょうど一致する ——「有機の官能基の酸化として扱うか」で線が引かれており、
   シュウ酸は無機の還元剤とまったく同じ扱い方をするため。この一致は回帰テストで固定する。 */
function isOrganicStage(stage) {
  return !!(stage && ORGANIC_OXIDANTS[stage.ox]);
}

/* ORGANIC_OXIDANTS の**逆向き版**。順位を持たない「酸化剤の側」について、相手を明示列挙する。
   キーは還元の式（＝酸化剤）、値は相手＝酸化の式（＝還元剤）の一覧。

   なぜ要るか: REDOX_LADDER_ACID は名前のとおり**酸性条件の梯子**で、中性・塩基性の梯子は
   このアプリに無い（作れば新しい暗唱表が1つ増えるし、高校で順位を扱わない）。
   だから MnO₄⁻ の中性・塩基性の式には順位を与えず、§2-7「梯子で語れないものは、
   正直に列挙する」に従って相手を書き出す。ここに無い相手は「反応しない」ではなく
   **undecided**（順位を持っていないので「しない」と言えない）。

   MnO4_red_neutral の相手を I_ox 1本に絞ってあるのは、教科書がこの液性で扱う組み合わせが
   それだからで、しかも I_ox は H⁺ も OH⁻ も含まない式なので**そのまま足して1本にできる**。
   H₂O₂ やアルコールの酸化はこのアプリでは酸性の書き方しか持っていないので、
   足すと H⁺ と OH⁻ が同じ式に並ぶ（→ writtenFor が wrong-condition で止める）。

   why は「列挙に載っていない相手だったとき」に返す文。**酸化剤ごとに理由が違う**ので
   1つの文で使い回さない（液性の話と、濃度・温度の話は別ものなのに、同じ文を出すと嘘になる）。 */
const LISTED_OXIDANTS = {
  "MnO4_red_neutral": {
    partners: ["I_ox"],
    why: "強さの順位（梯子）は酸性条件のものだけを持っています。この液性でのこの組み合わせは、" +
      "このアプリでは強弱を決めていません。",
  },
  /* 熱濃硫酸は**順位を持たせない**（M6-F）。標準電極電位でいえば SO₄²⁻/SO₂ は
     Cu²⁺/Cu より下にあり、梯子に素直に置くと「銅は溶けない」になってしまう。
     実際に銅を溶かすのは「熱くて濃い」からで、これは §9-1 の濃硝酸とまったく同じ
     **濃度効果**＝一次元の梯子に乗らないもの。無理に上へ置けば、こんどは Zn・Fe・Mg・
     シュウ酸・KI…と下にあるもの全部に「反応する」と言い切ってしまう（言い過ぎ）。
     §2-7「梯子で語れないものは、正直に列挙する」に従い、教科書が扱う相手だけを書く。

     相手を銅1本にしてあるのは、この試薬の見どころが
     **「銅は塩酸やうすい硫酸には溶けないのに、熱濃硫酸には溶ける」**という対比だから。
     Zn・Fe・Mg も実際には溶けるが、生成物が SO₂・S・H₂S と条件で変わって一本に決まらない
     （しかも冷濃硫酸なら Fe は不動態）ので、言い切らずに undecided に落とす。 */
  "H2SO4_hot_red": {
    partners: ["Cu_ox"],
    why: "熱濃硫酸が強い酸化剤としてはたらくのは「熱くて濃い」からで、その強さは" +
      "強さの順位（梯子）には乗りません。このアプリは、教科書が扱う相手だけを収録しています。",
  },
};

/* 例外表。順位では「反応する」になるが、実際にはそこで止まる組み合わせ。
   理由文が書けないものは載せない（載っているものは必ず理由が言える）。
   フィールド名を oxidant / reductant にしてあるのは、REDOX_STAGES の ox / red と
   意味が逆になるのを防ぐため（上の「用語の落とし穴」）。
   qa/KNOWLEDGE_CAVEATS.md H-2 も参照。言い方は「表面に被膜ができて、そこで止まる」
   （DESIGN §9-5・ユーザー判断。「まったく反応しない」とは書かない）。 */
const REDOX_EXCEPTIONS = [
  { oxidant: "NO3_red_conc", reductant: "Al_ox", code: "exception",
    message: "アルミニウムを濃硝酸に入れると、表面にち密な酸化被膜（不動態）ができて、そこで止まります。内側までは溶けません。" },
  { oxidant: "NO3_red_conc", reductant: "Fe_ox", code: "exception",
    message: "鉄を濃硝酸に入れると、表面にち密な酸化被膜（不動態）ができて、そこで止まります。内側までは溶けません。" },
  /* 順位では Ag⁺ ＞ I₂ なので「Ag⁺ が I⁻ から e⁻ を奪う」になるが、実際には
     先に AgI（黄色の沈殿）ができてしまい、そこで止まる。梯子が語れるのは
     「溶けたまま出会えたら、どちらへ動くか」だけで、別の反応が先に起きる場合は語れない。 */
  { oxidant: "Ag_red", reductant: "I_ox", code: "exception",
    message: "銀イオンとヨウ化物イオンは、e⁻ をやりとりする前に結びついて AgI（黄色の沈殿）になります。沈殿ができたところで止まるので、酸化還元は進みません。" },
  /* 硫化物の沈殿（M6-F）。AgI とまったく同じ形の例外で、順位では進む向きなのに
     **別の反応が先に起きる**。どちらも硫黄は −2 のまま・金属も酸化数が動かないので、
     起きているのは酸化還元ではなく「結びついて沈む」ほう。 */
  { oxidant: "Cu_red", reductant: "H2S_ox", code: "exception",
    message: "銅(Ⅱ)イオンと硫化水素は、e⁻ をやりとりする前に結びついて CuS（黒色の沈殿）になります。硫黄は −2 のまま、銅も +2 のままなので、これは酸化還元ではありません。" },
  { oxidant: "Ag_red", reductant: "H2S_ox", code: "exception",
    message: "銀イオンと硫化水素は、e⁻ をやりとりする前に結びついて Ag₂S（黒色の沈殿）になります。硫黄は −2 のまま、銀も +1 のままなので、これは酸化還元ではありません。" },
];

/* 選択肢に出す試薬。1つの物質が液性で違う半反応式になるので、ここで解決する。
   **ここに無い物質は選べない** ＝「収録した範囲でだけ言い切る」の実体（DESIGN §2-8）。

   half のキーは「その半反応式が必要とする液性」で、**式の形から導ける値と一致する**
   （left に H⁺ → "acid" / left に OH⁻ → "basic" / どちらも無い → "any"）。
   人が書いた液性と式の形が食い違わないことをテストで固定する。

   pairsWith は「この試薬について、反応すると言い切ってよい相手（半反応式 id）」の
   許可リスト。**梯子が reacts と言っても、この一覧に無ければ undecided に落とす**
   （順位を下げるのではなく、言い切る範囲を絞る。DESIGN §2-3 の欠点の手当て・§2-7）。 */
const REAGENTS = [
  /* --- e⁻ を受け取る側（酸化剤）。半反応式は kind:"reduction" --- */
  /* 液性で**式そのものが変わる**唯一の試薬（M6-D）。酸性なら Mn²⁺（ほぼ無色）、
     中性・塩基性なら MnO₂（黒褐色）。「液性が足りないから反応しない」のではないことを、
     この1本で実物として見せる（DESIGN §2-4）。 */
  { id: "KMnO4", sp: "KMnO4", side: "ox", label: "過マンガン酸カリウム",
    half: { acid: "MnO4_red", basic: "MnO4_red_neutral" },
    note: "赤紫色。酸性なら Mn²⁺（ほぼ無色）、中性・塩基性なら MnO₂（黒褐色）になる" },
  { id: "K2Cr2O7", sp: "K2Cr2O7", side: "ox", label: "二クロム酸カリウム",
    half: { acid: "Cr2O7_red" }, note: "橙色。還元されると緑色の Cr³⁺ になる" },
  { id: "HNO3_dil", sp: "HNO3", side: "ox", label: "希硝酸", variant: "希",
    half: { acid: "NO3_red" }, note: "酸化剤としてはたらくのは NO₃⁻。無色の NO が出る" },
  { id: "HNO3_conc", sp: "HNO3", side: "ox", label: "濃硝酸", variant: "濃",
    half: { acid: "NO3_red_conc" }, note: "赤褐色の NO₂ が出る。希硝酸と強さは分けていない（生成物が変わる）" },
  { id: "H2O2_asOxidant", sp: "H2O2", side: "ox", label: "過酸化水素（酸化剤として）",
    half: { acid: "H2O2_red" }, note: "同じ物質が還元剤の欄にも出る" },
  { id: "O3", sp: "O3", side: "ox", label: "オゾン", half: { acid: "O3_red" } },
  { id: "I2", sp: "I2", side: "ox", label: "ヨウ素", half: { any: "I2_red" } },
  { id: "HCl_dil", sp: "HCl", side: "ox", label: "うすい塩酸", variant: "希",
    half: { acid: "H_red" }, note: "酸化剤としてはたらくのは H⁺" },
  /* **札は必ず「熱濃硫酸」**（qa/KNOWLEDGE_CAVEATS.md H-2。「濃硫酸」と書くと、
     酸化作用のある熱濃硫酸と、Al・Fe・Ni を不動態にする冷濃硫酸が一緒くたになる）。
     順位は持たない ＝ 相手は LISTED_OXIDANTS で列挙する（上のコメント参照）。 */
  { id: "H2SO4_hot", sp: "H2SO4", side: "ox", label: "熱濃硫酸", variant: "熱・濃",
    half: { acid: "H2SO4_hot_red" },
    note: "熱くて濃いときだけ酸化剤。冷たい濃硫酸は Al・Fe・Ni の表面に被膜をつくる（不動態）" },
  /* 二酸化硫黄の酸化剤の顔（M6-F）。**相手は硫化水素だけ**に絞る。
     順位（SO2/S＝95）だけで見ると Cu・Zn・Fe・Mg にも「反応する」と言うことになるが、
     それは教科書が扱う話ではない（硫化物ができる別の反応になる）。
     ここで pairsWith を使い LISTED_OXIDANTS を使わないのは、**梯子の結論を1つ残したい**から
     ＝ KI 相手の「順序が逆」（SO₂ は I⁻ から e⁻ を奪えない）は、この試薬のいちばん大事な
     手ざわりで、列挙表に逃がすとその1行が出なくなる。 */
  { id: "SO2_asOxidant", sp: "SO2", side: "ox", label: "二酸化硫黄（酸化剤として）",
    half: { acid: "SO2_red" }, pairsWith: ["H2S_ox"],
    note: "同じ物質が還元剤の欄にも出る。酸化剤にまわるのは硫化水素が相手のときだけ" },
  { id: "CuSO4", sp: "CuSO4", side: "ox", label: "硫酸銅(Ⅱ)水溶液",
    half: { any: "Cu_red" }, note: "酸化剤としてはたらくのは Cu²⁺" },
  { id: "AgNO3", sp: "AgNO3", side: "ox", label: "硝酸銀水溶液",
    half: { any: "Ag_red" }, note: "酸化剤としてはたらくのは Ag⁺" },
  /* --- e⁻ を出す側（還元剤）。半反応式は kind:"oxidation" --- */
  { id: "Mg", sp: "Mg", side: "red", label: "マグネシウム", half: { any: "Mg_ox" } },
  { id: "Al", sp: "Al", side: "red", label: "アルミニウム", half: { any: "Al_ox" } },
  { id: "Zn", sp: "Zn", side: "red", label: "亜鉛", half: { any: "Zn_ox" } },
  { id: "Fe", sp: "Fe", side: "red", label: "鉄", half: { any: "Fe_ox" } },
  { id: "Cu", sp: "Cu", side: "red", label: "銅", half: { any: "Cu_ox" } },
  { id: "FeSO4", sp: "FeSO4", side: "red", label: "硫酸鉄(Ⅱ)",
    half: { any: "Fe2_ox" }, note: "還元剤としてはたらくのは Fe²⁺" },
  /* シュウ酸の順位（CO₂/C₂O₄²⁻）は梯子のかなり下なので、順位だけで見ると
     **ほぼすべての酸化剤と反応する**ことになってしまう。だが実際に高校で扱うのは
     KMnO₄ の滴定（と K₂Cr₂O₇）だけで、うすい塩酸から水素が出たりはしない
     （順位＝熱力学は語れても、速さは語れない。DESIGN §1「解決しないこと」）。
     Ag⁺・Cu²⁺ が相手なら先にシュウ酸塩の沈殿ができる。
     順位を動かすのではなく、**言い切る範囲を絞る**（DESIGN §2-8-4）。 */
  { id: "H2C2O4", sp: "H2C2O4", side: "red", label: "シュウ酸",
    half: { any: "oxalate_ox" }, pairsWith: ["MnO4_red", "Cr2O7_red"] },
  /* 逆に Cu²⁺ × I⁻ は、順位では ladder-reversed（反応しない）になる。
     実際には CuI が沈殿するぶん有利になって反応するが、これは高校の範囲外なので
     教科書どおり「Cu²⁺ は I⁻ から e⁻ を奪えない」で通す。 */
  { id: "KI", sp: "KI", side: "red", label: "ヨウ化カリウム",
    half: { any: "I_ox" }, note: "還元剤としてはたらくのは I⁻" },
  /* 硫化水素（M6-F）。**還元剤の欄にしか出ない**（S は −2 が下限で、それ以上 e⁻ を
     受け取れない）。pairsWith を付けていないのは、梯子の 85 に置いた時点で
     教科書どおりの相手（KMnO₄・K₂Cr₂O₇・O₃・H₂O₂・硝酸・I₂）がそろい、
     うすい塩酸では酸化されないところまで正しく出るから。Cu²⁺・Ag⁺ は例外表で止める。 */
  /* 二酸化硫黄の還元剤の顔（M6-F）。こちらが**本業**で、出番はこの向きのほうがずっと多い。
     順位（SO₄²⁻/SO₂＝85）は低いので、絞らないとほぼ全部の酸化剤と反応することになる
     （シュウ酸と同じ事情）。教科書が扱う相手 ＝ KMnO₄・K₂Cr₂O₇（色が変わる）・
     I₂（ヨウ素滴定）・H₂O₂・O₃ に絞る。硝酸・Ag⁺・Cu²⁺ は実際に起こることもあるが
     高校では扱わないので言い切らない。 */
  { id: "SO2_asReductant", sp: "SO2", side: "red", label: "二酸化硫黄（還元剤として）",
    half: { any: "SO2_ox" }, pairsWith: ["MnO4_red", "Cr2O7_red", "I2_red", "H2O2_red", "O3_red"],
    note: "こちらが本業。S が +4 なので、上（+6）にも下（0）にも動ける" },
  { id: "H2S", sp: "H2S", side: "red", label: "硫化水素",
    half: { any: "H2S_ox" },
    note: "腐卵臭の気体。S は −2 でこれ以上下がれないので、還元剤にしかなれない" },
  /* 同じ過酸化水素が酸化剤の欄にも出る（この設計の見どころ）。
     ただし**還元剤としての相手は極めて限られる**（qa/KNOWLEDGE_CAVEATS.md H-3。
     高校で出るのは実質 KMnO₄ と O₃ だけ）。梯子の順位だけで相手を広げないよう、
     言い切る範囲を pairsWith で絞る（DESIGN §2-7）。 */
  { id: "H2O2_asReductant", sp: "H2O2", side: "red", label: "過酸化水素（還元剤として）",
    half: { any: "H2O2_ox" }, pairsWith: ["MnO4_red", "O3_red"],
    note: "相手が自分より強い酸化剤のときだけ、還元剤の側にまわる" },
  /* 有機。順位を持たないので相手は ORGANIC_OXIDANTS で列挙する */
  { id: "C2H5OH", sp: "C2H5OH", side: "red", label: "エタノール", half: { any: "EtOH_ox" } },
  { id: "CH3CHO", sp: "CH3CHO", side: "red", label: "アセトアルデヒド", half: { any: "MeCHO_ox" } },
  { id: "C3H7OH", sp: "C3H7OH", side: "red", label: "2-プロパノール", half: { any: "iPrOH_ox" } },
];

/* 判定の返り値に入る理由コード。verdict ごとに使える値が決まっている（テストで固定）。

   wrong-condition を no-reaction ではなく undecided に置いているのは、
   「液性が足りないから**反応しない**」と言わないため（DESIGN §2-4）。
   MnO₄⁻ は中性・塩基性でも酸化剤としてはたらき、**式が変わる**（→MnO₂）だけなので、
   反応しないと断定すると嘘になる。言えるのは「この式では起こらない／未収録」まで。 */
const NO_REACTION_REASONS = ["same-role", "ladder-reversed", "exception"];
const UNDECIDED_REASONS = ["wrong-condition", "no-rank", "tie", "not-listed"];

function coupleOf(halfId) {
  const hr = HALF_REACTIONS[halfId];
  return hr ? hr.couple : undefined;
}

/* 対の名前 "酸化型/還元型" を SPECIES の id 2つに割る */
function coupleParts(couple) {
  const i = String(couple).indexOf("/");
  if (i < 0) return null;
  return { ox: couple.slice(0, i), red: couple.slice(i + 1) };
}

/* 表示用（画面に出すのは化学式だけ。**順位の数値は出さない**） */
function coupleDisp(couple) {
  const p = coupleParts(couple);
  if (!p || !SPECIES[p.ox] || !SPECIES[p.red]) return null;
  return { ox: SPECIES[p.ox].disp, red: SPECIES[p.red].disp };
}

/* 梯子の順位。載っていなければ null（＝判定しない） */
function rankOfCouple(couple) {
  const v = REDOX_LADDER_ACID[couple];
  return typeof v === "number" ? v : null;
}
function rankOfHalf(halfId) { return rankOfCouple(coupleOf(halfId)); }

/* 半反応式が必要とする液性を**式の形から**導く（追加データを持たない）。
   これは必要条件であって十分条件ではない ＝「H⁺ が無いからこの式では起こらない」
   までは言えるが、「だから何も起こらない」とは言えない（DESIGN §2-4）。

   ・左辺に H⁺ … その H⁺ を溶液から供給してもらう必要がある ＝ 酸性が要る
   ・OH⁻ が式のどちらの辺にあっても ＝ 塩基性の書き方
     （酸性の水溶液に OH⁻ は書けない。あれば H⁺ と結びついて水になる）
   M6-D で右辺の OH⁻ を足した。MnO4_red_neutral は左辺に H⁺ も OH⁻ も持たず、
   OH⁻ を**生む**形なので、これを見ないと「液性に依らない式」に見えてしまう。
   **右辺の H⁺ は酸性必須としない**（ここだけ左右で扱いが違う）。理由は、既存の式のうち
   有機の酸化・H2O2_ox・H2O_ox が「酸性・塩基性のどちらにも書き直せる式」を
   酸性の書き方で登録しているため。ここを acid にすると「この式でなければ起こらない」と
   言い過ぎになる。ただし**酸性の書き方の式と塩基性の書き方の式はそのまま足せない**ので、
   その judgement は writtenFor() が別に受け持つ。 */
function conditionOfHalf(hr) {
  if (hr.left.some((t) => t.sp === "H+")) return "acid";
  if ([...hr.left, ...hr.right].some((t) => t.sp === "OH-")) return "basic";
  return "any";
}

/* その半反応式が「どちらの液性の書き方で書かれているか」。conditionOfHalf が
   「その式を使うのに要る液性」なのに対し、こちらは**紙の上の書き方**を見る。
   H⁺ を含む式（左右どちらでも）は酸性の書き方、OH⁻ を含む式は塩基性の書き方。
   書き方が食い違う2本をそのまま足すと、1本の式に H⁺ と OH⁻ が並んでしまう
   （実際には結びついて水になるので、そういう式は書かない）。 */
function writtenFor(hr) {
  const all = [...hr.left, ...hr.right];
  if (all.some((t) => t.sp === "OH-")) return "basic";
  if (all.some((t) => t.sp === "H+")) return "acid";
  return "any";
}

/* 板として置ける種か（電荷0・元素1種・気体でない）。redox.js の isDepositable と同じ考え方。
   ここは「ステージが板ありモードか溶液モードか」を**データで持たずに導く**ために使う。 */
const NON_PLATEABLE_GAS = new Set(["H2", "O2", "O3", "N2", "Cl2"]);
function isPlateable(sp) {
  const s = SPECIES[sp];
  if (!s) return false;
  return !NON_PLATEABLE_GAS.has(sp) && s.charge === 0 && Object.keys(s.atoms).length === 1;
}

/* 半反応式2本から、REDOX_STAGES と同じ形のステージを組み立てる。
   引数の順は REDOX_STAGES と同じ（oxHalfId＝酸化される式・redHalfId＝還元される式）。

   answer（倍率）も mode（板あり／溶液中）も**持たずに導く**。
   既存14ステージの登録値と導出値が全部一致することをテストで固定してあるので、
   どちらかのデータが壊れたら回帰テストが落ちる。 */
function composeStage(oxHalfId, redHalfId) {
  const ox = HALF_REACTIONS[oxHalfId], red = HALF_REACTIONS[redHalfId];
  if (!ox || !red || ox.kind !== "oxidation" || red.kind !== "reduction") return null;
  const eO = electronsOf(ox), eR = electronsOf(red);
  const l = eO * eR / gcd2(eO, eR);            // e⁻ の最小公倍数
  const st = {
    id: "free:" + oxHalfId + "+" + redHalfId,
    title: ox.disp + " × " + red.disp,
    ox: oxHalfId, red: redHalfId,
    answer: [l / eO, l / eR],
  };
  // 酸化される側の出発種が板として置けないなら「溶液中」。置けるなら板ありで mode は持たない
  if (!ox.left.some((t) => isPlateable(t.sp))) st.mode = "solution";
  return st;
}

function reagentById(id) { return REAGENTS.find((r) => r.id === id) || null; }

/* 試薬 → その液性での半反応式 id（無ければ null） */
function halfOfReagent(rg, condition) {
  if (!rg || !rg.half) return null;
  return rg.half[condition] || rg.half.any || null;
}

/* 収録ステージのうち、この (ox, red) と一致するもの**一覧**。
   対応表を別に持たない（収録を変えたときに黙って壊れるのを防ぐ）。
   同じ組で複数のステージがある（ri1 と ri2）ので、1件ではなく一覧を返す。 */
function stagesForHalves(oxHalfId, redHalfId) {
  return REDOX_STAGES.filter((s) => s.ox === oxHalfId && s.red === redHalfId);
}

/* 半反応式を「その対の代表的な姿」で呼ぶ（メッセージ用）。
   酸化剤は酸化型（Ag⁺）、還元剤は還元型（Cu）で呼ぶのが読み手の感覚に合う。 */
function halfName(halfId, role) {
  const hr = HALF_REACTIONS[halfId];
  if (!hr) return String(halfId);
  const cd = hr.couple ? coupleDisp(hr.couple) : null;
  if (!cd) return hr.disp;
  return role === "oxidant" ? cd.ox : cd.red;
}

const UNDECIDED_MSG = "この組み合わせは、このアプリでは強弱を決めていません。";

/* 判定の本体。**半反応式2本**で受ける（試薬を経由しない経路。収録ステージの検査で使う）。
     oxidantHalfId   … 酸化剤の式（kind:"reduction"）
     reductantHalfId … 還元剤の式（kind:"oxidation"）
   opts.outsideAllowList … 試薬側の許可リストの外なら true（matchRedox が渡す）
   opts.oxName / opts.redName … メッセージで使う呼び名（試薬名。無ければ対から作る）

   判定の順序そのものが「どの理由を優先して見せるか」の設計判断。先に出たもので確定する。 */
function matchHalves(oxidantHalfId, reductantHalfId, opts) {
  const o = opts || {};
  const oxHR = HALF_REACTIONS[oxidantHalfId], redHR = HALF_REACTIONS[reductantHalfId];
  if (!oxHR || !redHR) {
    return { verdict: "undecided", reasonCode: "no-rank", message: UNDECIDED_MSG, stage: null };
  }
  // 1. 役が同じ（両方とも e⁻ を受け取る式／両方とも出す式）
  if (oxHR.kind === redHR.kind) {
    /* 主語は必ず「いま選んだ式」にする。H₂O₂ も Fe²⁺ も相手しだいで役が変わるので、
       「H₂O₂ は酸化剤です」のように**物質を主語にした断定を出してはいけない**（DESIGN §2-6） */
    const msg = oxHR.kind === "reduction"
      ? "どちらも e⁻ を「受け取る」側の式です。e⁻ を出す相手（還元剤）を選ぼう。"
      : "どちらも e⁻ を「出す」側の式です。e⁻ を受け取る相手（酸化剤）を選ぼう。";
    return { verdict: "no-reaction", reasonCode: "same-role", message: msg, stage: null };
  }
  if (oxHR.kind !== "reduction") {
    // 引数の向きが逆（呼び出し側の取り違え）。黙って入れ替えず、決めない
    return { verdict: "undecided", reasonCode: "no-rank", message: UNDECIDED_MSG, stage: null };
  }
  const oxName = o.oxName || halfName(oxidantHalfId, "oxidant");
  const redName = o.redName || halfName(reductantHalfId, "reductant");
  const reacts = () => ({
    verdict: "reacts", reasonCode: null, stage: composeStage(reductantHalfId, oxidantHalfId),
    message: oxName + " が e⁻ を受け取り、" + redName + " が e⁻ を出します。",
  });
  const undecided = (code, msg) =>
    ({ verdict: "undecided", reasonCode: code, message: msg || UNDECIDED_MSG, stage: null });

  /* 2. 液性の書き方がそろっていない（M6-D）。片方が酸性の書き方（H⁺ を含む）で
     もう片方が塩基性の書き方（OH⁻ を含む）だと、足したときに1本の式に H⁺ と OH⁻ が
     並んでしまう。ここで言えるのは「**この2本のままでは書けない**」までで、
     **「反応しない」とは言わない**（DESIGN §2-4）。書き換えの手順そのものは
     condition.html（液性で書き換えるモード）の担当。 */
  const wOx = writtenFor(oxHR), wRed = writtenFor(redHR);
  if (wOx !== "any" && wRed !== "any" && wOx !== wRed) {
    const jp = (w) => (w === "acid" ? "酸性" : "中性・塩基性");
    return undecided("wrong-condition",
      oxName + " の式は" + jp(wOx) + "の書き方、" + redName + " の式は" + jp(wRed) + "の書き方です。" +
      "書き方がそろっていないと1本にまとめられません。「反応しない」のではなく、" +
      "どちらかを別の式に書き直す必要があります。");
  }
  // 3. 例外表（順位では反応するが、実際にはそこで止まる）
  const ex = REDOX_EXCEPTIONS.find((e) => e.oxidant === oxidantHalfId && e.reductant === reductantHalfId);
  if (ex) return { verdict: "no-reaction", reasonCode: "exception", message: ex.message, stage: null };

  // 4. 順位を持たない側は、許可リストで相手を列挙する（有機の酸化と、中性・塩基性の酸化剤）。
  //    載っていない相手は「反応しない」ではなく undecided（順位を持っていないので言えない）
  const listed = LISTED_OXIDANTS[oxidantHalfId];
  if (listed) {
    if (listed.partners.includes(reductantHalfId) && !o.outsideAllowList) return reacts();
    return undecided("not-listed", listed.why);
  }
  if (ORGANIC_OXIDANTS[reductantHalfId]) {
    if (ORGANIC_OXIDANTS[reductantHalfId].includes(oxidantHalfId) && !o.outsideAllowList) return reacts();
    return undecided("not-listed");
  }
  // 5. 梯子で比べる
  const rOx = rankOfHalf(oxidantHalfId), rRed = rankOfHalf(reductantHalfId);
  if (rOx === null || rRed === null) return undecided("no-rank");
  if (rOx === rRed) return undecided("tie");
  if (rOx < rRed) {
    /* 「差が小さいから反応しない」とは**言わない**（DESIGN §2-6・採らなかった案3）。
       高校範囲では差の大小ではなく**順序**で決まる。理由は「順序が逆だから」だけ。 */
    const cOx = coupleDisp(oxHR.couple), cRed = coupleDisp(redHR.couple);
    return { verdict: "no-reaction", reasonCode: "ladder-reversed", stage: null,
      message: cOx.ox + " は " + cRed.ox + " より e⁻ を奪う力が弱いので、" +
        cRed.red + " から e⁻ を奪えません。順位は " + cRed.ox + " ＞ " + cOx.ox + " です。" };
  }
  // 6. 順位では反応するが、試薬の許可リストの外なら言い切らない
  if (o.outsideAllowList) return undecided("not-listed");
  return reacts();
}

/* 酸化剤と還元剤を**試薬で**選んだとき、反応するかどうかを返す（DESIGN §2-5・§5-3）。

   返り値 { verdict, reasonCode, message, stage }
     verdict "reacts"      … 反応する。stage を既存エンジンにそのまま渡せる
     verdict "no-reaction" … **理由が言える**ときだけ
     verdict "undecided"   … 判定しない（梯子に無い・同値・許可リストの外・液性が未収録） */
function matchRedox(oxidantReagentId, reductantReagentId, condition) {
  const cond = condition || "acid";
  const A = reagentById(oxidantReagentId), B = reagentById(reductantReagentId);
  if (!A || !B) {
    return { verdict: "undecided", reasonCode: "not-listed", stage: null,
      message: "このアプリに収録していない試薬です。" };
  }
  if (A.side === B.side) {
    const hA = halfOfReagent(A, cond), hB = halfOfReagent(B, cond);
    if (hA && hB) return matchHalves(hA, hB);   // same-role になる（主語は「いま選んだ式」）
    /* その液性で式が引けなくても、**役が同じことは試薬の side だけで言える**。
       液性の話（wrong-condition）より先に、まず役の取り違えを直してもらう。
       ここで matchHalves に null を渡すと「強弱を決めていない」に化けてしまう。 */
    return { verdict: "no-reaction", reasonCode: "same-role", stage: null,
      message: A.side === "ox"
        ? "どちらも e⁻ を「受け取る」側の式です。e⁻ を出す相手（還元剤）を選ぼう。"
        : "どちらも e⁻ を「出す」側の式です。e⁻ を受け取る相手（酸化剤）を選ぼう。" };
  }
  // 引数が入れ替わっていても side で分かるので、ここで正しい向きにそろえる
  const oxidant = A.side === "ox" ? A : B;
  const reductant = A.side === "ox" ? B : A;
  const oxHalfId = halfOfReagent(oxidant, cond);      // 酸化剤の式（kind:"reduction"）
  const redHalfId = halfOfReagent(reductant, cond);   // 還元剤の式（kind:"oxidation"）

  // その液性でどちらかの式が解決できない。**「反応しない」とは言わない**（DESIGN §2-4）
  if (!oxHalfId || !redHalfId) {
    const missing = !oxHalfId ? oxidant : reductant;
    const have = missing.half.acid ? "酸性条件" : "中性・塩基性";
    const want = cond === "acid" ? "酸性" : "中性・塩基性";
    /* 「別の式になる」を絵空事にしないため、**実際に収録している例をデータから引く**。
       手で名前を書くと、収録を増やしたときに黙って古くなる。 */
    const alt = REAGENTS.filter((r) => r.half[cond] && Object.keys(r.half).length > 1)
      .map((r) => r.label).join("・");
    return { verdict: "undecided", reasonCode: "wrong-condition", stage: null,
      message: SPECIES[missing.sp].disp + " の式は" + have + "のものです。" + want + "では" +
        "「反応しない」のではなく、別の式になります。その式はこのアプリにまだ収録していません" +
        (alt ? "（" + want + "の式を持っているのは " + alt + " だけです）" : "") + "。" };
  }
  // 試薬に許可リストがあるときは、その範囲でだけ「反応する」と言い切る
  const outsideAllowList =
    !!(reductant.pairsWith && !reductant.pairsWith.includes(oxHalfId)) ||
    !!(oxidant.pairsWith && !oxidant.pairsWith.includes(redHalfId));

  return matchHalves(oxHalfId, redHalfId, {
    outsideAllowList,
    oxName: SPECIES[oxidant.sp].disp,
    redName: SPECIES[reductant.sp].disp,
  });
}

/* イオン化傾向は**梯子から導く**（原理データを二重に持たない。DESIGN §2-3）。
   金属の対＝「還元型が単体（電荷0・元素1種）／酸化型が同じ元素の単原子陽イオン」の形。
   H⁺/H₂ もこの形なので、イオン化傾向の (H) が自然に混ざる（そこが境目だから重要）。
   I₂/I⁻ は還元型が陰イオンなので入らない。O₂/H₂O は還元型が単体でないので入らない。

   B3（DESIGN_battery_electrolysis.md）の電池モードは、**この導出をそのまま参照する**
   （先に実装したほうが元データを置く。あちらに別の配列を持たせると、順位を直したときに
   片方だけ古くなって黙って食い違う）。 */

/* 梯子から「金属の対」だけを抜き出す（[{ el, couple, rank }]・イオン化傾向の大きい順）。
   序列そのもの（IONIZATION_SERIES）と、金属 → 半反応式を引く道（halfOfMetal）の
   **両方がここ1か所から出る**ようにしてある。 */
function metalCouplesFromLadder() {
  const rows = [];
  for (const [couple, rank] of Object.entries(REDOX_LADDER_ACID)) {
    const p = coupleParts(couple);
    if (!p) continue;
    const ox = SPECIES[p.ox], red = SPECIES[p.red];
    if (!ox || !red) continue;
    const oxEls = Object.keys(ox.atoms), redEls = Object.keys(red.atoms);
    if (red.charge !== 0 || redEls.length !== 1) continue;   // 還元型が単体でない
    if (ox.charge <= 0 || oxEls.length !== 1) continue;      // 酸化型が単原子陽イオンでない
    if (oxEls[0] !== redEls[0]) continue;                    // 同じ元素の対でない
    rows.push({ el: redEls[0], couple, rank });
  }
  rows.sort((a, b) => a.rank - b.rank);   // 順位が低い＝イオン化傾向が大きい
  return rows;
}

function ionizationSeriesFromLadder() {
  return metalCouplesFromLadder().map((r) => r.el);
}
const IONIZATION_SERIES = ionizationSeriesFromLadder();

/* ================================================================================
   B3-1: 電池モードのモデル（DESIGN_battery_electrolysis.md §3。実装の刻み 1）
   すべて DOM 非依存の純ロジック。画面は battery.html / battery.js。

   ★ イオン化傾向の序列は新設しない ★
   設計書 §3-1 は IONIZATION_SERIES を新設する前提で書かれているが、それは古い記述で、
   **M6-A が梯子（REDOX_LADDER_ACID）から導出済み**。原理データを二重に持たない
   （DESIGN_redox_matching.md §2-3）ので、ここは**参照するだけ**。
   ================================================================================ */

/* 電極として選べる金属。**序列そのものとは別に持つ**「言い切れる範囲」の絞り込みで、
   原理データではない（順位は上の梯子が持つ）。序列 ["Mg","Al","Zn","Fe","H","Cu","Ag"]
   から2つ外してある:
     H  … 金属ではないので板にならない（序列には「境目」として載っている）
     Al … 表面のち密な酸化被膜のせいで、板として素直に負極にならない。
           §0「判断できない反応は候補に出さない」に従って候補から外す
   並びはイオン化傾向の大きい順（テストで序列との一致を固定する）。 */
const BATTERY_ELECTRODES = ["Mg", "Zn", "Fe", "Cu", "Ag"];

/* 序列の中の位置（小さいほどイオン化傾向が大きい）。載っていなければ −1 */
function ionizationRankOf(metal) { return IONIZATION_SERIES.indexOf(metal); }

/* 2枚の板のうち、e⁻ を出して溶けるほう（負極）を返す。
   **イオン化傾向の大きいほう**＝序列で先に出るほう。次のときは null:
     ・同じ金属2枚 … 差がないので e⁻ が動かない（「流れない」ことも発見のうち）
     ・序列に無い金属 … 順位を持たないので判定しない
   引数の順に依らない（negativeOf(a,b) === negativeOf(b,a)）。 */
function negativeOf(m1, m2) {
  const i = ionizationRankOf(m1), j = ionizationRankOf(m2);
  if (i < 0 || j < 0 || i === j) return null;
  return i < j ? m1 : m2;
}

/* 金属 → その金属の対を持つ半反応式の id（kind で向きを選ぶ）。
   命名の規則（"Zn" → "Zn_ox"）に頼らず**対（couple）で引く**。
   H⁺/H₂ の還元式が "H_red" のように、id が元素名と一致しない対があるため。 */
function halfOfMetal(metal, kind) {
  const row = metalCouplesFromLadder().find((r) => r.el === metal);
  if (!row) return null;
  const id = Object.keys(HALF_REACTIONS)
    .find((k) => HALF_REACTIONS[k].couple === row.couple && HALF_REACTIONS[k].kind === kind);
  return id || null;
}

/* 板2枚 → 両極の半反応式（＋ REDOX_STAGES と同じ形のステージ）。

   **ステージに ox / red の id を直書きしない**ための一本化（§3-2）。
   電極を選び直したら式も差し替わる、が電池モードの核なので、式の解決はここだけが持つ。
     負極(−) … 溶ける金属の**酸化**の式（Zn → Zn²⁺ ＋ 2e⁻）
     正極(+) … 相手のイオンの**還元**の式（Cu²⁺ ＋ 2e⁻ → Cu）
   倍率（answer）と足し合わせは composeStage / checkRedoxMultipliers / combineHalves に
   そのまま乗る（既存の枠を無改修で流用する。§0）。

   決められないときは reason を返す（式を捏造しない）:
     same-metal … 同じ金属2枚。差がないので電流が流れない
     not-ranked … 序列に無い金属
     no-half    … 順位はあるが、その向きの半反応式を収録していない
                  （例: Mg と Zn の組は、正極側の Zn²⁺ ＋ 2e⁻ → Zn を持っていない）。
                  「反応しない」ではなく「このアプリでは扱えない」 */
function halvesForPair(m1, m2) {
  const neg = negativeOf(m1, m2);
  if (!neg) {
    /* 「同じ金属2枚」と言えるのは**両方が序列に載っている**ときだけ。
       b2 は板を選ぶ前（両方 undefined）にもここを通るので、そこを same-metal と
       言ってしまうと「差がないから流れない」という結論を、まだ何も選んでいない盤面に出す */
    const ranked = ionizationRankOf(m1) >= 0 && ionizationRankOf(m2) >= 0;
    return { neg: null, pos: null, reason: ranked && m1 === m2 ? "same-metal" : "not-ranked" };
  }
  const pos = neg === m1 ? m2 : m1;
  const ox = halfOfMetal(neg, "oxidation");
  const red = halfOfMetal(pos, "reduction");
  if (!ox || !red) return { neg, pos, reason: "no-half" };
  return { neg, pos, ox, red, stage: composeStage(ox, red) };
}

/* その金属を板にしたときの電解液（見た目と電池式に使う。**原理データではない**）。
   板の金属のイオンが溶けている水溶液を、その板の槽に入れる——ダニエル電池の作りをそのまま
   一般化したもの。Ag だけ硝酸塩なのは Ag₂SO₄ が水にとけにくいため。 */
const ELECTRODE_ELECTROLYTE = {
  "Mg": "MgSO4", "Zn": "ZnSO4", "Fe": "FeSO4", "Cu": "CuSO4", "Ag": "AgNO3",
};

/* ステージが電解液を明示していればそれを、無ければ上の既定表を引く。
   b2（電極を自分で選ぶ課題）は組み合わせが決まっていないので、既定表のほうを使う。 */
function electrolyteFor(stage, metal) {
  if (stage && stage.electrolyte && stage.electrolyte[metal]) return stage.electrolyte[metal];
  return ELECTRODE_ELECTROLYTE[metal] || null;
}

/* metal と組ませて**最後まで言い切れる**相手だけを返す（§0「判断できない反応は候補に出さない」）。

   ここで落ちるのは「反応しない組み合わせ」ではなく、**このアプリが正極側の還元の式を
   持っていない組み合わせ**（例: Mg と Zn。Zn²⁺ ＋ 2e⁻ → Zn を収録していない）。
   起きることを言い切れない以上、選択肢に出さないほうが正直。

   **同じ金属どうしは残す**。「差がないと電流が流れない」ことは言い切れる結論であって、
   判断できない組み合わせではない（§2-1 のとおり、それも発見のうち）。 */
function batteryPartnersOf(metal) {
  if (!BATTERY_ELECTRODES.includes(metal)) return [];
  return BATTERY_ELECTRODES.filter((m) => m === metal || !!halvesForPair(metal, m).ox);
}

/* 電池ステージ（§3-2）。**answer も電池式も持たずに導く**
   （composeStage と同じ考え方。導出値はテストで固定する）。

   electrolyte は**役ではなく金属で引く**形にしてある（設計書は { neg, pos } だった）。
   役で持つと「Zn が負極」をデータ側が先に決めてしまい、電極を選び直したら式が
   差し替わる、という核と食い違う。金属で引けば、役は negativeOf が決めたとおりになる。

   ※ id の名前空間はモードごと。CONDITION_STAGES にも "b1" があるが、
     別の配列・別のページなので衝突しない（横断で id を突き合わせる場所は無い）。 */
const BATTERY_STAGES = [
  {
    id: "b1", kind: "battery", title: "ダニエル電池", metals: ["Zn", "Cu"],
    electrolyte: { Zn: "ZnSO4", Cu: "CuSO4" },
    intro: "亜鉛板と銅板を、それぞれ硫酸亜鉛水溶液・硫酸銅(Ⅱ)水溶液にひたして導線でつなぐ。" +
      "どちらの板が溶けると思う？ 板をタップして予想してから、つないでみよう。",
  },
  /* b2: 板を自分で2枚選ぶ課題（実装の刻み4）。**metals を持たない**のが b1 との違いで、
     選んだ2枚が metals の代わりになる（画面側が差し込む）。
     電解液も答えも電池式も、選んだ金属から導く——つまりこのデータには
     「どちらが負極か」を決めるものが1つも入っていない。それが b2 の狙い。 */
  {
    id: "b2", kind: "battery", title: "電極を選ぶ", choose: true, electrodes: BATTERY_ELECTRODES,
    intro: "板を2枚選んで電池を組み立てよう。選んだら、どちらが溶けるかを予想してからつなぐ。" +
      "同じ板を2枚選ぶこともできる（そのときどうなるかも、確かめてみる価値がある）。",
  },
];

/* 電池式（教科書表記）。(−) 負極 ｜ 電解液 ｜ 電解液 ｜ 正極 (+)。
   どちらが (−) かは negativeOf が決めるので、ここも順序を直書きしない。 */
function cellNotation(stage) {
  const ms = (stage && stage.metals) || [];
  const h = halvesForPair(ms[0], ms[1]);
  if (!h.neg) return null;
  const salt = (m) => {
    const sp = electrolyteFor(stage, m);
    return sp && SPECIES[sp] ? SPECIES[sp].disp + " aq" : "?";
  };
  return `(−) ${SPECIES[h.neg].disp} | ${salt(h.neg)} | ${salt(h.pos)} | ${SPECIES[h.pos].disp} (+)`;
}

/* 電池ステージ → REDOX_STAGES と同じ形のステージ。
   これを既存の checkRedoxMultipliers / combineHalves にそのまま渡す。 */
function batteryStageOf(stage) {
  const ms = (stage && stage.metals) || [];
  const h = halvesForPair(ms[0], ms[1]);
  if (!h.stage) return null;
  // composeStage が付ける "free:…" は自由組み立てモードの名札なので、電池のものに付け替える
  return Object.assign({}, h.stage, { id: "battery:" + stage.id, title: stage.title });
}

/* ================================================================================
   B3-5: 電気分解（DESIGN_battery_electrolysis.md §3-3。実装の刻み5）

   電池の「逆向き」だが、**e⁻ が流れる理由がまったく違う**。
   電池はイオン化傾向の差が e⁻ を動かす。電気分解は**電源が押し込む**。
   だから電気分解では電極を選ばせない（§3-3。不活性電極が前提）し、
   「イオン化傾向で決まる」も持ち込まない。半反応式の文法だけが同じ。

   用語も違う。**同じ「酸化が起きる極」なのに、電池では負極、電気分解では陽極**。
   ここが最大のつまずきなので、データ属性は酸化側／還元側で統一し、
   **表示名だけ**モードで差し替える（下の ELECTRODE_TERMS）。
   ================================================================================ */

/* 電極の呼び名。ox＝酸化が起きる極（e⁻ が導線へ出ていく）／red＝還元が起きる極。
   物理的な中身は両モードで同じで、名前と符号だけが違う——それを言い切るための表。 */
const ELECTRODE_TERMS = {
  battery: {
    ox: "負極(−)", red: "正極(+)",
    oxTag: "負極(−)・酸化", redTag: "正極(+)・還元",
  },
  electrolysis: {
    ox: "陽極", red: "陰極",
    oxTag: "陽極・酸化", redTag: "陰極・還元",
  },
};
function electrodeTerms(kind) { return ELECTRODE_TERMS[kind] || ELECTRODE_TERMS.battery; }

/* 電気分解ステージ。**確言できる系だけ**を収録する（§0・§6）。
   電極は不活性（炭素・白金）で固定。陽極が溶ける系（銅の精錬）は第2弾の読み物。
   answer は持たず composeStage が導く（電池ステージと同じ流儀）。 */
const ELECTROLYSIS_STAGES = [
  {
    id: "e1", kind: "electrolysis", title: "塩化銅(Ⅱ)水溶液の電気分解",
    solution: "CuCl2", electrode: "C",
    anode: "Cl_ox",     // 陽極（酸化）: 2Cl⁻ → Cl₂ ＋ 2e⁻
    cathode: "Cu_red",  // 陰極（還元）: Cu²⁺ ＋ 2e⁻ → Cu
    intro: "電源につなぐと、e⁻ が押し込まれて反応が始まる。" +
      "陰極には銅が析出し、陽極からは塩素が発生する。両極の e⁻ の数を合わせよう。",
  },
  {
    id: "e2", kind: "electrolysis", title: "水の電気分解（希硫酸）",
    solution: "H2SO4", electrode: "Pt",
    anode: "H2O_ox",    // 陽極（酸化）: 2H₂O → O₂ ＋ 4H⁺ ＋ 4e⁻
    cathode: "H_red",   // 陰極（還元）: 2H⁺ ＋ 2e⁻ → H₂
    intro: "希硫酸に白金電極をひたして電源につなぐ。硫酸は電流を通すために入れるだけで、" +
      "変化するのは水。陰極から水素、陽極から酸素が出る。",
  },
];

/* 電気分解ステージ → REDOX_STAGES と同じ形（ox / red / answer）。
   **陽極が ox・陰極が red** で固定（電気分解では役が入れ替わらない）。 */
function electrolysisStageOf(stage) {
  if (!stage || !stage.anode || !stage.cathode) return null;
  const st = composeStage(stage.anode, stage.cathode);
  if (!st) return null;
  return Object.assign({}, st, { id: "electrolysis:" + stage.id, title: stage.title });
}

/* 電池と電気分解をひとつづきに並べたステージ表（画面はこの並びで出す）。
   1〜2 が電池、3〜4 が電気分解。**続けて遊ぶと用語の違いが body に入る**のが狙い。 */
const CELL_STAGES = BATTERY_STAGES.concat(ELECTROLYSIS_STAGES);

/* ---- 科目・単元ツリー（入り口ページ portal.html が使う）----
   「いま自分がどの科目のどの単元をやっているのか」から入れるようにするための表。
   ステージの所属は**既にあるタグから引く**ので、ステージを足しても単元表を直さずに済む
   （どのステージもどこかの単元に入ることはテストで機械検証する）。
   modes: ion＝イオン反応（index.html）／redox＝酸化還元／condition＝液性 */
const CURRICULUM = [
  {
    subject: "化学基礎",
    units: [
      { id: "u-neutral", name: "酸と塩基・中和", tags: ["中和"],
        note: "H⁺ と OH⁻ が結びついて水になる。係数は「個数がちょうど合う比」" },
      { id: "u-salt", name: "塩の分類（正塩・酸性塩）", tags: ["酸性塩"],
        note: "中和しきらずに H⁺ が残ると酸性塩になる" },
      { id: "u-redox-basic", name: "酸化還元の基礎（酸化数・イオン化傾向）",
        redox: ["r1", "r2", "r3", "r4"],
        note: "金属が e⁻ を出して溶け、別の金属が析出する" },
    ],
  },
  {
    subject: "化学",
    units: [
      { id: "u-redox-half", name: "酸化還元と半反応式", redox: ["rs1", "rs2", "rs3", "rn1", "rn2"],
        note: "半反応式を整数倍して e⁻ をそろえ、足し合わせる" },
      { id: "u-condition", name: "液性による書き換え（酸性 ⇄ 塩基性）", condition: ["b1", "b2", "b3", "b4"],
        note: "両辺に OH⁻ を足して H₂O にまとめ、相殺する" },
      { id: "u-redox-organic", name: "有機の酸化（アルコール）", redox: ["ro1", "ro2", "ro3"],
        note: "官能基のついた炭素1個の酸化数が上がる" },
      { id: "u-iodoform", name: "ヨードホルム反応", redox: ["ri1", "ri2"],
        note: "メチル基の H が I に置き換わり、切れて黄色い沈殿になる" },
      { id: "u-precip", name: "沈殿とイオンの組み合わせ", tags: ["沈殿"],
        note: "水に溶けない組み合わせができると固体になって沈む" },
      { id: "u-complex", name: "錯イオンと沈殿の再溶解", tags: ["錯イオン", "沈殿の再溶解"],
        note: "配位子が中心イオンを囲むと、沈殿がふたたび溶ける" },
      { id: "u-amphoteric", name: "両性水酸化物", tags: ["両性水酸化物"],
        note: "少量の NaOH で沈殿、過剰で再溶解。2本の式として扱う" },
      { id: "u-gas", name: "気体の発生・弱酸の遊離", tags: ["気体発生", "弱酸の遊離"],
        note: "弱酸が追い出されて気体になって逃げる" },
      { id: "u-weak", name: "弱酸・弱塩基と塩の加水分解（電離平衡）", tags: ["弱酸", "弱塩基", "加水分解"],
        note: "分子のまま溶け、反応のときだけ電離して補う。塩になっても一部は元の弱酸・弱塩基に戻る" },
      { id: "u-molecule", name: "分子の反応（燃焼と原子の保存）", tags: ["分子反応"],
        note: "イオンではなく原子にばらけて組み替わる" },
    ],
  },
];

/* 単元に属するステージを引く（[{ mode, id, title }]）。
   タグ指定はイオン反応モードのステージから、redox/condition は id 直指定から集める。 */
function stagesOfUnit(unit) {
  const out = [];
  if (unit.tags) {
    for (const st of STAGES) {
      const tags = STAGE_TAGS[st.id] || [];
      if (unit.tags.some((t) => tags.includes(t))) out.push({ mode: "ion", id: st.id, title: st.title });
    }
  }
  for (const id of unit.redox || []) {
    const st = REDOX_STAGES.find((s) => s.id === id);
    if (st) out.push({ mode: "redox", id, title: st.title });
  }
  for (const id of unit.condition || []) {
    const st = CONDITION_STAGES.find((s) => s.id === id);
    if (st) out.push({ mode: "condition", id, title: st.title });
  }
  return out;
}

/* ヨード化のあとの切断。OH⁻ が C–C 結合を切って、黄色沈殿のヨードホルムが落ちる。
   **正味の酸化数の増減が 0 ＝酸化還元ではない**（e⁻ の数合わせが要らない）。
   ただし C–C を切ると結合の電子はどちらか一方に割り当てられるので、
   原子ごとに見ると ±1 の入れ替わりが起こることがある
   （アセトンはメチル −3→−2 とカルボニル +2→+1、アセトアルデヒドはメチル −3→−2 と
   カルボニル +1→0 で、どちらも打ち消し合って正味0）。
   ヨード化と切断を分けて見せる理由がここにある。 */
/* この数え方についてのただし書き。**実際の反応機構とは違う**ことを画面に必ず出す。
   便宜的な見方であること、どこが違うか、それでも係数は同じになることを1か所で持つ
   （両ステージが同じ文を出すため、また文面を直すときに散らばらないため）。 */
const IODOFORM_CAVEAT = {
  head: "注: これは実際の反応機構とは異なります",
  body: "「メチル基を CH₃⁺ として切り離す」のは、電子の勘定を合わせて半反応式にするための" +
    "便宜的な見方です。実際は、塩基が α 水素を引き抜いてヨウ素が1つずつ入る操作を3回くり返し、" +
    "最後に OH⁻ がカルボニル炭素を攻撃して **CI₃⁻ が陰イオンとして外れます**" +
    "（切れる順番も電荷の符号も逆）。ただし数え方が違うだけで、" +
    "全体式の係数（I₂ 3個）は実際の反応と一致します。",
};

const IODOFORM_CLEAVAGE = {
  acetone: {
    left: [{ sp: "CH3COCH3", n: 1 }],
    right: [{ sp: "CH3+", n: 1 }, { sp: "CH3CO-", n: 1 }],
    rest: "acylRest_ox",
    overall: "CH₃COCH₃ ＋ 3I₂ ＋ 4NaOH → CHI₃ ＋ CH₃COONa ＋ 3NaI ＋ 3H₂O",
    note: "残った CH₃CO⁻ は、このあと酢酸イオンになる。",
  },
  acetald: {
    left: [{ sp: "CH3CHO", n: 1 }],
    right: [{ sp: "CH3+", n: 1 }, { sp: "CHO-", n: 1 }],
    rest: "formylRest_ox",
    overall: "CH₃CHO ＋ 3I₂ ＋ 4NaOH → CHI₃ ＋ HCOONa ＋ 3NaI ＋ 3H₂O",
    note: "残った CHO⁻ は、このあとギ酸イオンになる。切り出す CH₃⁺ はアセトンと同じ。",
  },
};

/* 切断の段が酸化還元でないこと（両辺で原子ごとの酸化数がそろっていること）を確かめる。
   ついでに原子と電荷の保存も返す。テストとUIの両方から使う。 */
function checkCleavage(cv) {
  const cmp = compareSides(cv.left, cv.right);
  const shifts = oxChangeOfHalf({ left: cv.left, right: cv.right, kind: "none" });
  // 正味の増減は**元素ごとの酸化数の合計の差**で測る。
  // 原子ごとに ±1 入れ替わっていても、打ち消し合えば合計は動かない＝酸化還元ではない
  const L = oxAtomLists(cv.left), R = oxAtomLists(cv.right);
  const sum = (a) => (a || []).reduce((x, y) => x + y, 0);
  let net = 0;
  for (const el of new Set([...Object.keys(L), ...Object.keys(R)])) net += sum(R[el]) - sum(L[el]);
  return { balanced: cmp.balanced, net, redox: net !== 0, shifts, cmp };
}

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
  const g = gcd2(a, b);
  if (g !== 1) {
    // e⁻ の数だけ見ていると気づけないので、割る数と割った先まで示す
    return {
      ok: false, gcd: g, give, take,
      reason: `e⁻ の数は合っているけれど、倍率がどちらも ${g} で割り切れる。` +
        `×${a}・×${b} → ×${a / g}・×${b / g} に直そう（e⁻ ${give}個 → ${give / g}個 でも成り立つ）`,
    };
  }
  return { ok: true, give, take };
}

/* 分子反応式（化学反応式）の検算。筆算の⑤行目が正しく導けたかを、
   原子・電荷の保存と最簡整数比で確かめる（molecularizeStep から呼ぶ）。 */
function checkMolecularEq(stage, coeffs) {
  const me = stage && stage.molecularEq;
  if (!me) return { ok: false, reason: "この反応には分子反応式が登録されていない" };
  const nL = me.reactants.length;
  if (coeffs.length !== nL + me.products.length) {
    return { ok: false, reason: "係数の数が反応式の項の数と合っていません" };
  }
  if (coeffs.some((c) => !Number.isInteger(c) || c < 1)) {
    return { ok: false, reason: "すべての係数を1以上の整数で入力してください" };
  }
  const left = me.reactants.map((sp, i) => ({ sp, n: coeffs[i] }));
  const right = me.products.map((sp, i) => ({ sp, n: coeffs[nL + i] }));
  const cmp = compareSides(left, right);
  if (cmp.balanced) {
    const g = gcdAll(coeffs);
    if (g !== 1) {
      return {
        ok: false, gcd: g, cmp,
        reason: `つり合っているけれど、係数がすべて ${g} で割り切れる。` +
          `${coeffs.join(" : ")} → ${coeffs.map((c) => c / g).join(" : ")} に直そう`,
      };
    }
    return { ok: true, cmp };
  }
  return { ok: false, cmp, reason: "左右で原子の数が合っていません" };
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

/* ================================================================================
   ③ イオン反応式の係数を、先に自分で言う（v182・【C】）

   ユーザーの指摘:「イオン反応式についても、係数入力をした方がよいかもしれません」。

   ⚠ **そのまま入力欄にすると「写すだけ」になる。** 倍率 ×a・×b を決めた時点で、
   筆算の2行（×a した式・×b した式）が画面に出ており、イオン反応式の係数は
   その2行から**目で拾えてしまう**。それでは何も測っていない。

   だから「入力を足す」のではなく、**順番を入れ替える**:
     ・①の半反応式（倍率をかけていない素の式）と、②で決めた ×a・×b だけを手がかりに
     ・**筆算の2行を伏せたまま**、足し合わせた結果の係数を先に言う
     ・言い切ってから筆算が現れて、答え合わせになる
   ＝ 掛け算と、e⁻ が消えることの2つを、自分で通ってから確かめる形。
   （v174 の「比予想クイズ」＝ 先に言い切ってから試す、と同じ流儀）

   ここが持つのは判定だけ。**模範の係数は手で持たない**（combineHalves が出す）。
   ================================================================================ */

/* 係数を聞く項の並び（左辺 → 右辺。e⁻ は消えているので出てこない）。
   各項に「どちらの半反応式から来て、何倍されるか」を添える ＝ 外したときの助言に使う。 */
function ionicCoeffRows(stage, a, b) {
  if (!stage || !HALF_REACTIONS[stage.ox] || !HALF_REACTIONS[stage.red]) return null;
  const ionic = combineHalves(stage, a, b);
  const ox = HALF_REACTIONS[stage.ox], red = HALF_REACTIONS[stage.red];
  const inHalf = (hr, sp) => hr.left.some((t) => t.sp === sp) || hr.right.some((t) => t.sp === sp);
  const decorate = (side) => ionic[side].filter((t) => t.sp !== "e-").map((t) => {
    const fromOx = inHalf(ox, t.sp), fromRed = inHalf(red, t.sp);
    return {
      side, sp: t.sp, n: t.n,
      // 両方に出る種（H₂O など）は「両方から」。どちらでもないことは起こらない
      from: fromOx && fromRed ? "both" : fromOx ? "ox" : "red",
      mult: fromOx && fromRed ? null : fromOx ? a : b,
    };
  });
  const terms = decorate("left").concat(decorate("right"));
  return { left: terms.filter((t) => t.side === "left"), right: terms.filter((t) => t.side === "right"), terms };
}

/* 入れた係数の判定。**答えの数は言わない** —— どの項が違うか と、その数がどこから来るか まで。 */
function checkIonicCoeffs(stage, a, b, coeffs) {
  const rows = ionicCoeffRows(stage, a, b);
  if (!rows) return null;
  const want = rows.terms.map((t) => t.n);
  const got = rows.terms.map((_, i) => coeffs[i]);
  const filled = got.filter((c) => Number.isInteger(c) && c >= 1).length;
  const D = (sp) => SPECIES[sp].disp;
  if (filled < want.length) {
    return { ok: false, kind: "partial", filled, total: want.length, wrong: [],
      reason: `あと ${want.length - filled} つ。①の式に ×${a}・×${b} をかけて足すと、それぞれ何個になる？` };
  }
  const wrong = [];
  for (let i = 0; i < want.length; i++) if (got[i] !== want[i]) wrong.push(i);
  if (!wrong.length) {
    return { ok: true, kind: "ok", filled, total: want.length, wrong: [],
      reason: `そのとおり。①の2本に ×${a}・×${b} をかけて足すと、e⁻ が両辺で同じ数になって消える。` };
  }
  // よくある外し方: 全体が同じ倍率になっている（＝最簡比まで詰めていない／倍率をかけ違えた）
  const k = got[0] / want[0];
  if (Number.isInteger(k) && k > 1 && want.every((w, i) => got[i] === w * k)) {
    return { ok: false, kind: "scaled", k, filled, total: want.length, wrong,
      reason: `形は合っているが、ぜんぶが ${k} 倍になっている。両辺を ${k} で割った形が答え。` };
  }
  const t = rows.terms[wrong[0]];
  const where = t.from === "both"
    ? "両方の式に出てくる（足すときに合わせる）"
    : `${t.from === "ox" ? "【還元剤】（酸化される式）" : "【酸化剤】（還元される式）"}から来ていて、その式は ×${t.mult}`;
  return { ok: false, kind: "wrong", filled, total: want.length, wrong,
    reason: `${wrong.length}つ違う。たとえば ${t.side === "left" ? "左辺" : "右辺"} の ${D(t.sp)} —— これは ${where}。` };
}

/* 筆算の4〜5行目「両辺に傍観イオンを ${added} 個ずつ足して分子反応式に戻す」。

   イオン反応式に残っている自由なイオン（左辺の H⁺・右辺の Cu²⁺）は、
   相手の傍観イオンと組んで初めて分子・塩の姿になる。何個足りるかは左右それぞれで数えられ、
   電荷が保存しているので**左右の答えは必ず一致する**（テストで固定）。
   added が足りなければ組めなかったイオンが free に残り、多ければ傍観イオン自身が free に残る。
   ＝この段は「free が空になる added を探す」パズルになっている。

   join の書式（v134 で一般化。rn 系の従来データはそのまま動く）:
     { side, ion, per, to }                 … ion 1個 ＋ 傍観 per 個 → to 1個（従来形）
     { side, ion, ionN, per, to }           … ion ionN 個 ＋ 傍観 per 個 → to 1個
                                              （例: 2H⁺＋SO₄²⁻→H₂SO₄、2Cr³⁺＋3SO₄²⁻→Cr₂(SO₄)₃）
     { side, ion, withSp, withN, per: 0, to } … ion 1個 ＋ 別の固定イオン withN 個 → to 1個
                                              （例: Cr₂O₇²⁻＋2K⁺→K₂Cr₂O₇。傍観プールは使わない）
   me.fixed = [{ side, sp, n }] は「数を探さなくてよい傍観イオン」。K₂Cr₂O₇ の K⁺ のように
   酸化剤の係数から数が決まっているものを、その辺の項として最初から加えておく
   （ステッパーで探すのは me.spectator の1種類だけ、という UI は変えない）。 */
function molecularizeStep(stage, a, b, added) {
  const me = stage && stage.molecularEq;
  if (!me) return null;
  const ionic = combineHalves(stage, a, b);
  const nOf = (terms, sp) => (terms.find((t) => t.sp === sp) || { n: 0 }).n;
  const build = (name, terms0) => {
    const joins = me.join.filter((j) => j.side === name);
    const fixed = (me.fixed || []).filter((f) => f.side === name);
    const terms = [...terms0, ...fixed.map((f) => ({ sp: f.sp, n: f.n }))];
    // withSp（先行の join が消費する固定イオン）を残数で追うため、種ごとの在庫を持つ
    const counts = {};
    for (const t of terms) if (t.sp !== me.spectator) counts[t.sp] = (counts[t.sp] || 0) + t.n;
    const have = nOf(terms, me.spectator);
    let pool = have + added;
    const made = [], free = [];
    let want = 0;
    for (const t of terms) {
      if (t.sp === me.spectator) continue;
      const avail = counts[t.sp];
      if (!avail) continue;               // 先行の join（withSp）で使い切られた
      const j = joins.find((x) => x.ion === t.sp);
      if (!j) { made.push({ sp: t.sp, n: avail }); counts[t.sp] = 0; continue; }
      const ionN = j.ionN || 1;
      let units = Math.floor(avail / ionN);
      if (j.withSp) units = Math.min(units, Math.floor((counts[j.withSp] || 0) / j.withN));
      want += units * j.per;
      const n = j.per > 0 ? Math.min(units, Math.floor(pool / j.per)) : units;
      if (n > 0) {
        made.push({ sp: j.to, n });
        pool -= n * j.per;
        if (j.withSp) counts[j.withSp] -= n * j.withN;
      }
      counts[t.sp] = 0;
      const rest = avail - n * ionN;
      if (rest > 0) free.push({ sp: t.sp, n: rest, joinTo: j.to, per: j.per });
    }
    if (pool > 0) free.push({ sp: me.spectator, n: pool });
    return { terms: made.concat(free.map((f) => ({ sp: f.sp, n: f.n }))), made, free, have, want, need: want - have };
  };
  const left = build("left", ionic.left), right = build("right", ionic.right);
  const need = Math.max(left.need, right.need);
  const res = { spectator: me.spectator, ionic, left, right, need, added, consistent: left.need === right.need };
  res.ok = added === need && !left.free.length && !right.free.length;
  const label = (n, sp) => (n > 1 ? n + " " : "") + SPECIES[sp].disp;
  const sD = SPECIES[me.spectator].disp;
  if (res.ok) {
    // 完成形は化学反応式の並び（reactants / products の登録順）でそろえて見せる
    const orderBy = (terms, list) => [...terms].sort((x, y) => list.indexOf(x.sp) - list.indexOf(y.sp));
    left.terms = orderBy(left.terms, me.reactants);
    right.terms = orderBy(right.terms, me.products);
    // 導いた分子反応式の係数。データの模範解と一致することはテストで固定する
    const nL = me.reactants.length;
    res.coeffs = [...me.reactants.map((sp) => nOf(res.left.terms, sp)),
                  ...me.products.map((sp) => nOf(res.right.terms, sp))];
    res.verified = checkMolecularEq(stage, res.coeffs).ok;
    res.reason = `ぴったり。両辺に ${sD} を ${need} 個ずつ足すと、` +
      `左辺は ${left.made.map((t) => label(t.n, t.sp)).join(" ＋ ")}、` +
      `右辺は ${right.made.map((t) => label(t.n, t.sp)).join(" ＋ ")} になる。` +
      (me.fixedNote ? me.fixedNote : "");
    void nL;
  } else if (added < need) {
    const say = (name, s) => s.free.filter((f) => f.joinTo).map((f) =>
      `${name}の ${label(f.n, f.sp)} が ${SPECIES[f.joinTo].disp} になれない`).join("、");
    const parts = [say("左辺", left), say("右辺", right)].filter(Boolean);
    res.reason = `${need - added} 個足りない。${parts.join("／")}。` +
      `${sD} と組まないとイオンのままで、分子反応式にならない。` +
      (me.fixedNote ? me.fixedNote : "");
  } else {
    res.reason = `${added - need} 個多い。相手のいない ${sD} が ${added - need} 個、両辺に残ってしまう` +
      `（両辺に同じだけ残るなら、はじめから足さないのと同じ）。`;
  }
  return res;
}


/* ================================================================================
   瓶から化学反応式を組み立てる（v180・DESIGN_redox.md「瓶から化学反応式を組み立てる」）

   イオン反応式の次の一歩を「両辺に傍観イオンを足す」ではなく、
   **ビーカーに実際に入れた瓶から出発する**形で表す。

     ビーカーに入れたもの  【KMnO₄】【FeSO₄】【H₂SO₄】
           ↓ 溶ける       K⁺ MnO₄⁻ ／ Fe²⁺ SO₄²⁻ ／ H⁺ SO₄²⁻
           ↓ 反応         5Fe²⁺ ＋ MnO₄⁻ ＋ 8H⁺ → 5Fe³⁺ ＋ Mn²⁺ ＋ 4H₂O
           ↓ 水を蒸発     2KMnO₄ ＋ 10FeSO₄ ＋ 8H₂SO₄ → 5Fe₂(SO₄)₃ ＋ 2MnSO₄ ＋ K₂SO₄ ＋ 8H₂O

   **左辺は組み立てない ＝ 瓶がそのまま左辺**。だから KMnO₄ ＋ KI で HI は作りようがない
   （HI という瓶を入れていない）。ここが2つのつまずきの分かれ目:
     ・なぜ硫酸イオンを「加える」のか → 加えていない。H₂SO₄ の瓶を入れたから H⁺ について来た
     ・左辺のイオンどうしを組んでしまう → 出自が別なので組めない（互いを連れてきていない）

   ステージが持つのは `bottles: ["KMnO4", "FeSO4", "H2SO4"]` の1本だけで、
   本数・傍観イオン・右辺の塩・全体の倍率は**すべてここから導く**（対応表を手で書かない）。
   ================================================================================ */

/* 瓶が水に入って出すもの。電離表に無いもの（金属板・有機分子）は**それ自身1個**として扱う。
   これで Zn や C₂H₅OH も「瓶」の枠にそのまま乗る（別の分岐を作らない）。 */
function bottlePartsOf(sp) {
  return DISSOCIATION[sp] || [sp];
}
function bottleDissolves(sp) {
  return !!DISSOCIATION[sp];
}

/* 陽イオンと陰イオンが**電荷でちょうど釣り合う最小の組**。個数は手で書かず電荷から出す
   （Fe³⁺ と SO₄²⁻ なら lcm(3,2)=6 → Fe³⁺ 2個 ＋ SO₄²⁻ 3個）。 */
function saltUnit(cationSp, anionSp) {
  const p = SPECIES[cationSp] && SPECIES[cationSp].charge;
  const m = SPECIES[anionSp] && -SPECIES[anionSp].charge;
  if (!(p > 0) || !(m > 0)) return null;
  const l = p * m / gcd2(p, m);
  return { cn: l / p, an: l / m };
}

/* 対 → 組成式。**個数は持たない**（saltUnit が出す）。
   組成式の原子数が cn・an と一致することは回帰テストで機械検証する
   ＝ ここに釣り合わない塩を書いても黙って通らない。 */
const SALT_FORMULA = {
  "Fe^2+|SO4^2-": "FeSO4",
  "Fe^3+|SO4^2-": "Fe2(SO4)3",
  "Mn^2+|SO4^2-": "MnSO4",
  "Cr^3+|SO4^2-": "Cr2(SO4)3",
  "K+|SO4^2-":    "K2SO4",
  "Zn^2+|SO4^2-": "ZnSO4",
  "Al^3+|SO4^2-": "Al2(SO4)3",
  "Cu^2+|SO4^2-": "CuSO4",
  "Zn^2+|Cl-":    "ZnCl2",
  "Cu^2+|NO3-":   "Cu(NO3)2",
  "Ag+|NO3-":     "AgNO3",
};

function saltOf(cationSp, anionSp) {
  const u = saltUnit(cationSp, anionSp);
  const sp = SALT_FORMULA[cationSp + "|" + anionSp];
  if (!u || !sp) return null;
  return { cation: cationSp, anion: anionSp, cn: u.cn, an: u.an, sp };
}

/* この段を画面に出すか。**既存の筆算（molecularEq）を持つステージには出さない**
   ＝ 1つのステージに2つの作り方を並べない（理由は DESIGN_redox.md）。 */
function bottleStepOf(stage) {
  return (stage && stage.bottles && !stage.molecularEq) ? stage.bottles : null;
}

/* 瓶からの組み立て一式。倍率 a・b は③で決まったものをそのまま使い、
   scale は「イオン反応式の全体を何倍するか」。 */
function bottlePlan(stage, a, b, scale) {
  const list = stage && stage.bottles;
  if (!list || !list.length) return null;
  const s = Number.isInteger(scale) && scale >= 1 ? scale : 1;
  const ionic = combineHalves(stage, a, b);
  const need = ionic.left.filter((t) => t.sp !== "e-").map((t) => ({ sp: t.sp, n: t.n * s }));
  const nOf = (terms, sp) => (terms.find((t) => t.sp === sp) || { n: 0 }).n;

  /* --- ① 左辺のイオンを、それを出せる瓶に割り当てる ---

     v182 までは「ちょうど1本が担当する」ことを要求していた。v183 で
     **1つのイオンを複数の瓶が担当する**形まで広げた（【G】・rs3 シュウ酸）。
       5 C₂O₄²⁻ ＋ 2 MnO₄⁻ ＋ 16 H⁺ → …
       H⁺ 16個は H₂C₂O₄（5本ぶんで 10個）と H₂SO₄（3本ぶんで 6個）の**両方**から出る。
     これは硝酸の二役（1本が複数のイオンを担当する）とは向きが逆で、別ものの一般化。

     決め方は2段。**連立方程式にしない**（「割り算で本数が出る」という見え方を保つため）:
       段1 … そのイオンを出せる瓶が1本しかないものを先に決める（C₂O₄²⁻ → H₂C₂O₄ 5本）
       段2 … 出どころが複数のイオンは、段1で決まった瓶が連れてくるぶんを**引いて**、
              残りを残った1本が出す（16 − 10 ＝ 6 → H₂SO₄ 3本）
     残った瓶が1本に決まらないときだけデータの不備とする。 */
  const per = {}, sources = {}, dataError = [];
  for (const sp of list) {
    per[sp] = {};
    for (const p of bottlePartsOf(sp)) per[sp][p] = (per[sp][p] || 0) + 1;
  }
  for (const t of need) {
    sources[t.sp] = list.filter((sp) => per[sp][t.sp]);
    if (!sources[t.sp].length) dataError.push(`${t.sp} を出す瓶が無い`);
  }
  // owners は「単独の出どころ」だけを持つ（④の選択肢と説明が使う）。
  // 複数から来るイオンは owners に載せず、multi に内訳を持たせる
  const owners = {}, multi = {}, count = {}, contrib = {};
  for (const sp of list) contrib[sp] = {};
  for (const t of need) if (sources[t.sp].length === 1) owners[t.sp] = sources[t.sp][0];

  // 段1: 単独で担当しているイオンから本数を出す（1本が複数を担当するならその最大 ＝ 硝酸の二役）
  for (const sp of list) {
    const sole = need.filter((t) => owners[t.sp] === sp);
    if (!sole.length) continue;
    count[sp] = sole.reduce((mx, t) => Math.max(mx, Math.ceil(t.n / per[sp][t.sp])), 0);
    for (const t of sole) contrib[sp][t.sp] = t.n;
  }
  // 段2: 出どころが複数のイオン
  for (const t of need) {
    const src = sources[t.sp];
    if (src.length <= 1) continue;
    let rest = t.n;
    const parts = [], undecided = [];
    for (const sp of src) {
      if (count[sp] === undefined) { undecided.push(sp); continue; }
      const use = Math.min(per[sp][t.sp] * count[sp], rest);
      if (use > 0) { contrib[sp][t.sp] = use; rest -= use; parts.push({ sp, n: use, kind: "rider" }); }
    }
    if (rest > 0) {
      if (undecided.length !== 1) {
        dataError.push(`${t.sp} の残り ${rest}個 を出す瓶が決まらない（未決 ${undecided.length} 本）`);
        continue;
      }
      const sp = undecided[0];
      count[sp] = Math.ceil(rest / per[sp][t.sp]);
      contrib[sp][t.sp] = rest;
      parts.push({ sp, n: rest, kind: "added" });
    } else if (undecided.length) {
      dataError.push(`${t.sp} は足りているのに ${undecided.join("・")} の本数が決まらない`);
    }
    multi[t.sp] = { need: t.n, parts };
  }

  // --- ② 瓶ごとの姿にまとめる ---
  const bottles = list.map((sp) => {
    const n = count[sp] || 0;
    const mine = need.filter((t) => contrib[sp][t.sp] > 0);
    return {
      sp, parts: bottlePartsOf(sp), per: per[sp], n, dissolves: bottleDissolves(sp),
      // covers の need は「この瓶が担当するぶん」。単独なら全量、分担なら自分の受け持ちぶん
      covers: mine.map((t) => ({
        sp: t.sp, need: contrib[sp][t.sp], per: per[sp][t.sp],
        total: t.n, shared: sources[t.sp].length > 1,
      })),
      // 一緒に来たが反応しないぶん（＝これが「加えたように見える」SO₄²⁻ の正体）。
      // HNO₃ のように担当イオンが余る形（8本ぶんの NO₃⁻ のうち 2個だけ還元される）も同じ引き算で出る
      riders: Object.keys(per[sp])
        .map((p) => ({ sp: p, n: per[sp][p] * n - (contrib[sp][p] || 0) }))
        .filter((r) => r.n > 0),
    };
  });

  // --- ③ 蒸発後に残るものを集める（イオン反応式の右辺 ＋ 全部の瓶の傍観ぶん）---
  //     並びは「右辺 → 傍観」の順に作る。この順がそのまま化学反応式の並びになる
  const pool = {};
  const addPool = (sp, k) => { if (k > 0) pool[sp] = (pool[sp] || 0) + k; };
  for (const t of ionic.right) if (t.sp !== "e-") addPool(t.sp, t.n * s);
  for (const B of bottles) {
    for (const p of Object.keys(B.per)) addPool(p, B.per[p] * B.n - (contrib[B.sp][p] || 0));
  }
  const cations = [], anions = [], neutral = [];
  for (const sp of Object.keys(pool)) {
    const q = SPECIES[sp].charge;
    (q > 0 ? cations : q < 0 ? anions : neutral).push({ sp, n: pool[sp] });
  }
  // 陰イオンが2種あると「どちらと組むか」がデータの決めごとになるので、この図法では扱わない
  if (anions.length > 1) dataError.push("蒸発後に陰イオンが2種以上ある: " + anions.map((x) => x.sp).join("・"));

  // --- ④ 対にして塩に戻す ---
  const salts = [], leftover = [];
  const anion = anions.length === 1 ? anions[0] : null;
  let rest = anion ? anion.n : 0;
  for (const c of cations) {
    const u = anion && saltOf(c.sp, anion.sp);
    if (!u) { leftover.push({ sp: c.sp, n: c.n, why: "noSalt" }); continue; }
    const units = Math.floor(c.n / u.cn);
    if (units > 0) { salts.push(Object.assign({}, u, { n: units })); rest -= units * u.an; }
    const spare = c.n - units * u.cn;
    if (spare > 0) leftover.push({ sp: c.sp, n: spare, why: "odd", per: u.cn, to: u.sp, total: c.n });
  }
  if (rest > 0) leftover.push({ sp: anion.sp, n: rest, why: "spare" });

  const left = bottles.filter((B) => B.n > 0).map((B) => ({ sp: B.sp, n: B.n }));
  const right = salts.map((x) => ({ sp: x.sp, n: x.n })).concat(neutral);
  const coeffs = left.map((t) => t.n).concat(right.map((t) => t.n));
  const balanced = compareSides(left, right).balanced;
  const g = gcdAll(coeffs) || 1;
  const simplest = g === 1;
  const ok = !dataError.length && !leftover.length && balanced && simplest;

  const res = {
    scale: s, ionic, need, owners, sources, multi, contrib, bottles, pool, cations, anions, neutral,
    salts, leftover, left, right, coeffs, balanced, simplest, gcd: g,
    dataError: dataError.length ? dataError : null, ok,
  };
  res.reason = bottlePlanReason(res);
  return res;
}

/* 失敗の理由を1か所で持つ（画面もテストもここを見る）。**黙って弾かない**ための本体。 */
function bottlePlanReason(res) {
  const D = (sp) => SPECIES[sp].disp;
  if (res.dataError) return "データの不備: " + res.dataError.join("／");
  if (res.leftover.length) {
    const parts = res.leftover.map((f) => {
      if (f.why === "odd") {
        return `${D(f.sp)} が ${f.total}個。${D(f.to)} は ${D(f.sp)} を ${f.per}個ずつ使うので ${f.n}個あまる` +
          `（${D(f.sp)} の数が ${f.per} の倍数になる倍率にしよう）`;
      }
      if (f.why === "spare") return `${D(f.sp)} が ${f.n}個あまる`;
      return `${D(f.sp)} と組める塩が登録されていない`;
    });
    // **どの倍率にすればよいかは言わない**（minBottleScale を呼ぶと答えそのものになる）。
    // 言うのは「何が何個ずつ要るか」までで、そこから倍率を決めるのが学習者の仕事
    return parts.join("／") + "。イオン反応式の全体の倍率を変えると、あまりを消せる。";
  }
  if (!res.balanced) return "左右で原子か電荷が合っていない（データの不備）";
  if (!res.simplest) {
    return `つり合っているけれど、係数がすべて ${res.gcd} で割り切れる。全体を ×${res.scale / res.gcd} に戻そう。`;
  }
  const say = (t) => (t.n > 1 ? t.n + " " : "") + D(t.sp);
  return `ぴったり。${res.left.map(say).join(" ＋ ")} → ${res.right.map(say).join(" ＋ ")}`;
}

/* 成立する最小の倍率。1 から順に試す（lcm を組み立てるより、条件を1か所にまとめられる）。 */
function minBottleScale(stage, a, b) {
  for (let s = 1; s <= 12; s++) {
    const p = bottlePlan(stage, a, b, s);
    if (p && p.ok) return s;
  }
  return null;
}

/* ================================================================================
   ⑤の数入力（v182・B）— 「どのイオンを何個加えるか」を**瓶の本数**で入力させる

   v181 の⑤は「全体を ×N」のステッパー1つで、本数の割り算は**画面が答えを表示していた**。
   ユーザーの指摘「どのイオンを何個加えるか、というところを入力することに意味があります
   （実際に反応式を書くときに必要な作業）」に合わせ、そこを学習者に入れさせる。

   **聞くのは本数であって「両辺に何個足すか」ではない**（DESIGN_redox.md の B）。
   ④で「SO₄²⁻ は H₂SO₄ が連れてきた」と言った直後に「何個足しますか」と聞くと、
   ④で言ったことを⑤が取り消す。本数を決めれば、ついて来るイオンの数は掛け算で決まる。
   ================================================================================ */

/* ⑤で数を聞く行。**瓶の並びそのまま**で、答え（本数）と、その根拠になる割り算を持つ。
   値は全部 bottlePlan から取る ＝ 導出を二重に書かない。 */
function bottleCountRows(stage, a, b, scale) {
  const plan = bottlePlan(stage, a, b, scale);
  if (!plan || plan.dataError) return null;
  return plan.bottles.map((B) => ({
    sp: B.sp, answer: B.n, per: B.per, covers: B.covers,
    dissolves: B.dissolves, riders: B.riders,
  }));
}

/* 入れた本数の判定と**理由**。合っていても外していても言葉を返す（黙って弾かない）。
   判定は個数だけ（DOM にも座標にも触れない）。 */
function explainBottleCount(stage, a, b, scale, sp, n) {
  const rows = bottleCountRows(stage, a, b, scale);
  const row = rows && rows.find((r) => r.sp === sp);
  if (!row) return null;
  const D = (x) => SPECIES[x].disp;
  if (!Number.isInteger(n) || n < 1) {
    return { ok: false, kind: "none", answer: row.answer, reason: "" };
  }
  // 担当しているイオンごとに「この本数だと何個出るか」を突き合わせる。
  // covers が空の瓶（起こらないはずだが）は本数そのものを比べる
  const bad = row.covers.find((c) => c.per * n !== c.need);
  if (bad) {
    const got = bad.per * n;
    return {
      ok: false, kind: got < bad.need ? "few" : "many", answer: row.answer,
      reason: `${D(sp)} が ${n}本 だと ${D(bad.sp)} は ${bad.per}×${n}＝${got}個。` +
        // **答えの本数は言わない**（1本ぶんが何個かまでを言い、割り算は学習者の仕事）
        // 【G】分担しているイオン（rs3 の H⁺）は「全体の何個のうち、この瓶が何個」まで言う
        (bad.shared
          ? `イオン反応式には ${bad.total}個 要り、そのうち ${bad.need}個 がこの瓶のぶん`
          : `イオン反応式には ${bad.need}個 要る`) +
        (bad.per > 1 ? `（${D(sp)} 1本からは ${D(bad.sp)} が ${bad.per}個 出る）` : "") + "。",
    };
  }
  if (n !== row.answer) {
    return {
      ok: false, kind: "many", answer: row.answer,
      reason: `${D(sp)} は ${row.answer}本 でちょうど足りる。`,
    };
  }
  const riders = row.riders.filter((r) => r.n > 0);
  let msg = row.covers.map((c) =>
    `${D(c.sp)} が ${c.need}個 要る ÷ ${D(sp)} 1本ぶんの ${c.per}個 ＝ ${row.answer}本。`).join("");
  if (riders.length) {
    msg += `一緒に ${riders.map((r) => `${D(r.sp)} が ${r.n}個`).join("・")} ついて来る` +
      `（加えたのではなく、瓶が連れてきた）。`;
  }
  return { ok: true, kind: "ok", answer: row.answer, reason: msg };
}

/* 入れた本数がぜんぶ正しいか（画面が⑤の続きを出してよいか）。 */
function bottleCountsDone(stage, a, b, scale, counts) {
  const rows = bottleCountRows(stage, a, b, scale);
  if (!rows) return false;
  return rows.every((r) => counts[r.sp] === r.answer);
}

/* 瓶が連れてきた傍観イオンの合計。**筆算の「両辺に N 個足す」の N と同じ数**になり、
   ここが2つの作り方の橋になる（DESIGN_redox.md の B）。
   反応に使われず、蒸発後にそのまま残るイオンだけを数える。 */
function bottleRiderTotals(stage, a, b, scale) {
  const plan = bottlePlan(stage, a, b, scale);
  if (!plan || plan.dataError) return null;
  const tot = {};
  for (const B of plan.bottles) {
    for (const r of B.riders) if (r.n > 0) tot[r.sp] = (tot[r.sp] || 0) + r.n;
  }
  return Object.keys(tot).map((sp) => ({ sp, n: tot[sp] }));
}

/* 【D】全体の倍率は**例外**（DESIGN_redox.md の D）。
   ユーザーの言葉:「イオン反応式全体を2倍するのは、レアケース、右辺で係数に 1/2 が
   でてきたときに必要な措置です／他の場合は考慮する必要がありません」。
   だから**半端が出たときだけ** null 以外を返す ＝ ふだんは倍率という言葉を画面に出さない。 */
function bottleScaleAdvice(stage, a, b, scale) {
  const plan = bottlePlan(stage, a, b, scale);
  if (!plan || plan.dataError) return null;
  const D = (x) => SPECIES[x].disp;
  const odd = plan.leftover.find((f) => f.why === "odd");
  if (!odd) {
    // 半端が消えているなら、倍にした側にだけ「戻せる」ことを言う（常設はしない）
    if (scale > 1) {
      return {
        kind: "revert", to: 1, from: scale,
        reason: `いまは式の全体を ×${scale} にしている。半端が出ていないなら ×1 のままでよい。`,
      };
    }
    return null;
  }
  const to = minBottleScale(stage, a, b);
  // 「係数に 1/2 が出る」を数そのもので言う（2.5個）。0.5 刻みでない半端も同じ言い方で通る
  const units = odd.total / odd.per;
  const unitsText = Number.isInteger(units) ? String(units) : String(Math.round(units * 100) / 100);
  return {
    kind: "half", to, from: scale, sp: odd.sp, saltSp: odd.to,
    total: odd.total, per: odd.per, units,
    reason: `${D(odd.sp)} が ${odd.total}個。${D(odd.to)} は ${D(odd.sp)} を ${odd.per}個ずつ使うので、` +
      `${D(odd.to)} が ${unitsText}個 ＝ 係数に 1/2 が出てしまう。` +
      `こういうときだけ、式の全体を倍にして整数にそろえる。`,
  };
}

/* ④「どの瓶が連れてきた？」の選択肢。**罠も導出する** ——
   左辺にいる反対符号のイオンを「◯◯ と組む」として並べる。
   これが KMnO₄ ＋ KI で H⁺ と I⁻ を組んで HI を作ってしまう、あのつまずきそのもの。 */
function bottleOwnerChoices(stage, a, b) {
  const plan = bottlePlan(stage, a, b, 1);
  if (!plan || plan.dataError) return null;
  const left = plan.ionic.left.filter((t) => t.sp !== "e-");
  return left.map((t) => {
    const src = plan.sources[t.sp] || [];
    const shared = src.length > 1;
    const options = stage.bottles.map((sp) => ({ kind: "bottle", sp }));
    /* 【G】出どころが2本ある H⁺（rs3）は、「**両方から**」を選択肢に混ぜる。
       どちらか1本を選ばせる形は採らない —— 実際どちらからも来ているのだから、
       片方を正解にすると嘘を教えることになる。逆に、片方だけを選んだときの
       「それだけでは何個足りない」がこのステージの見せ場（シュウ酸は弱酸なので硫酸が要る）。 */
    if (shared) options.push({ kind: "bottles", sps: src.slice() });
    for (const o of left) {
      if (o.sp === t.sp) continue;
      if (SPECIES[t.sp].charge * SPECIES[o.sp].charge < 0) options.push({ kind: "ion", sp: o.sp });
    }
    return {
      ion: t.sp, n: t.n, options, shared,
      answer: shared ? null : plan.owners[t.sp],
      answerKey: shared ? "bottles:" + src.join("+") : "bottle:" + plan.owners[t.sp],
    };
  });
}

/* 選んだ答えの判定と**理由**。合っていても間違っていても言葉を返す。 */
function explainBottleOwner(stage, a, b, ionSp, choice) {
  const plan = bottlePlan(stage, a, b, 1);
  if (!plan || plan.dataError) return null;
  const D = (sp) => SPECIES[sp].disp;
  const owner = plan.owners[ionSp];
  const dissolveText = (sp) => {
    if (!bottleDissolves(sp)) return `${D(sp)} は水にとけてイオンに分かれない（そのまま ${D(sp)} として入る）`;
    const per = {};
    for (const p of bottlePartsOf(sp)) per[p] = (per[p] || 0) + 1;
    const say = Object.keys(per).map((p) => (per[p] > 1 ? per[p] + "個の " : "") + D(p)).join(" と ");
    return `${D(sp)} は水にとけて ${say} に分かれる`;
  };
  const src = plan.sources[ionSp] || [];
  const shared = src.length > 1;
  const nameOf = (sp) => D(sp);
  if (choice && choice.kind === "ion") {
    // 出どころは1本とはかぎらない（rs3 の H⁺）ので、どちらの場合も並べて言う
    const bringers = (sp) => (plan.sources[sp] || []).map(nameOf).join(" と ");
    return {
      ok: false, kind: "not-together",
      reason: `${D(ionSp)} と ${D(choice.sp)} は互いを連れてきていません。` +
        `${D(ionSp)} を連れてきたのは ${bringers(ionSp)}、` +
        `${D(choice.sp)} を連れてきたのは ${bringers(choice.sp)}。` +
        `イオン反応式の左辺は、水の中でばらけたあとの姿です。` +
        `ここに並ぶイオンどうしを組み直しても、瓶に入れた物質にはなりません。`,
    };
  }
  /* 【G】出どころが2本ある H⁺（rs3）。**「両方から」が正解**で、
     片方だけを選んだときの「それだけでは何個足りない」がこのステージの見せ場 */
  if (shared) {
    const m = plan.multi[ionSp];
    const share = (sp) => (m.parts.find((x) => x.sp === sp) || { n: 0 }).n;
    if (choice && choice.kind === "bottles") {
      const got = (choice.sps || []).slice().sort().join("+");
      if (got === src.slice().sort().join("+")) {
        return {
          ok: true, kind: "ok-shared",
          reason: `そのとおり。${D(ionSp)} ${m.need}個 は1本の瓶では足りません —— ` +
            m.parts.map((x) => `${D(x.sp)} が ${x.n}個`).join("、") + `。` +
            `${D(src[0])} は弱酸なので、これだけでは酸性が足りない。` +
            `残りを強酸の ${D(src[src.length - 1])} で補います。`,
        };
      }
      return { ok: false, kind: "wrong-bottle", reason: "その組み合わせでは足りません。" };
    }
    if (!choice || choice.kind !== "bottle") return { ok: false, kind: "none", reason: "まだ選んでいません。" };
    if (!src.includes(choice.sp)) {
      return { ok: false, kind: "wrong-bottle", reason: `${dissolveText(choice.sp)}。${D(ionSp)} は出しません。` };
    }
    const mine = share(choice.sp);
    return {
      ok: false, kind: "not-enough",
      reason: `${D(choice.sp)} は ${D(ionSp)} を出しますが、${mine}個 だけ。` +
        `イオン反応式には ${m.need}個 要るので ${m.need - mine}個 足りません。` +
        `${D(ionSp)} はもう1本の瓶からも来ています。`,
    };
  }
  if (!choice || choice.kind !== "bottle") return { ok: false, kind: "none", reason: "まだ選んでいません。" };
  if (choice.sp !== owner) {
    return {
      ok: false, kind: "wrong-bottle",
      reason: `${dissolveText(choice.sp)}。${D(ionSp)} は出しません。`,
    };
  }
  const B = plan.bottles.find((x) => x.sp === owner);
  const riders = B.riders.filter((r) => r.n > 0);
  const perN = B.per[ionSp];
  let msg = `そのとおり。${dissolveText(owner)}`;
  if (bottleDissolves(owner) && perN > 1) msg += `（${D(owner)} 1本につき ${D(ionSp)} が ${perN}個）`;
  msg += "。";
  if (riders.length) {
    msg += `一緒に来た ${riders.map((r) => D(r.sp)).join(" と ")} は反応しないが、` +
      `ビーカーの中にはいる —— 水を蒸発させるとここから出てくる。`;
  }
  return { ok: true, kind: "ok", reason: msg };
}

/* ---- 液性の切り替え（酸性条件 ⇄ 塩基性条件）----
   同じ酸化還元でも、液性によって半反応式の書き方が変わる。別々に暗記するのではなく、
   **酸性の式の両辺に OH⁻ を同数足す → H⁺ と OH⁻ が結びついて H₂O になる →
   両辺に共通する H₂O を相殺する** という操作で導けることを見せる。
   （※この操作で導けるのは「同じ酸化還元を書き換えただけ」の場合。MnO₄⁻ の塩基性形のように
     生成物も e⁻ の数も変わるものは別の半反応式であって、ここでは扱わない） */

const CONDITION_STAGES = [
  {
    id: "b1", title: "水の電気分解・陰極（H₂ が出る側）", half: "H_red", answerOH: 2,
    basic: { left: [{ sp: "H2O", n: 2 }, { sp: "e-", n: 2 }],
             right: [{ sp: "H2", n: 1 }, { sp: "OH-", n: 2 }] },
    intro: "酸性なら H⁺ が e⁻ を受け取って H₂ になる。でも塩基性の水溶液に H⁺ はほとんど無い。両辺に OH⁻ を足して書き直そう。",
  },
  {
    id: "b2", title: "水の電気分解・陽極（O₂ が出る側）", half: "H2O_ox", answerOH: 4,
    basic: { left: [{ sp: "OH-", n: 4 }],
             right: [{ sp: "O2", n: 1 }, { sp: "H2O", n: 2 }, { sp: "e-", n: 4 }] },
    intro: "酸性なら水が酸化されて O₂ と H⁺ になる。塩基性では出てきた H⁺ が残れない。両辺に OH⁻ を足すと、左辺が OH⁻ だけの式になる。",
  },
  {
    id: "b3", title: "オゾンが酸化剤としてはたらくとき", half: "O3_red", answerOH: 2,
    basic: { left: [{ sp: "O3", n: 1 }, { sp: "H2O", n: 1 }, { sp: "e-", n: 2 }],
             right: [{ sp: "O2", n: 1 }, { sp: "OH-", n: 2 }] },
    intro: "オゾンは O 3個のうち1個だけが還元されて水になる（残り2個は O₂ のまま）。酸性の式を塩基性に直すと、右辺が OH⁻ になる。",
  },
  {
    id: "b4", title: "過酸化水素が酸化剤としてはたらくとき", half: "H2O2_red", answerOH: 2,
    basic: { left: [{ sp: "H2O2", n: 1 }, { sp: "e-", n: 2 }],
             right: [{ sp: "OH-", n: 2 }],
    },
    intro: "H₂O₂ の O は −1（過酸化物の例外）。酸性では H₂O になるが、塩基性では OH⁻ になる。同じ操作で導けるか試そう。",
  },
];

/* 酸性条件の半反応式の両辺に OH⁻ を k 個ずつ足して、塩基性条件の形へ直す。
   返り値には途中経過（中和した数・相殺した H₂O の数）も入れて、筆算の各行に使う。 */
function toBasicHalf(hr, k) {
  const put = (map, terms) => { for (const t of terms) map[t.sp] = (map[t.sp] || 0) + t.n; };
  const L = {}, R = {};
  put(L, hr.left); put(R, hr.right);
  const need = (L["H+"] || 0) + (R["H+"] || 0);
  if (!Number.isInteger(k) || k < 0) return { ok: false, need, reason: "足す数は0以上の整数で" };
  // ① 両辺に OH⁻ を k 個ずつ
  L["OH-"] = (L["OH-"] || 0) + k;
  R["OH-"] = (R["OH-"] || 0) + k;
  const added = { left: [...hr.left.map((t) => ({ ...t })), { sp: "OH-", n: k }],
                  right: [...hr.right.map((t) => ({ ...t })), { sp: "OH-", n: k }] };
  // ② 同じ辺の H⁺ と OH⁻ が結びついて H₂O に
  const neutralized = {};
  for (const [side, map] of [["left", L], ["right", R]]) {
    const n = Math.min(map["H+"] || 0, map["OH-"] || 0);
    if (n > 0) { map["H+"] -= n; map["OH-"] -= n; map["H2O"] = (map["H2O"] || 0) + n; }
    neutralized[side] = n;
  }
  const toTerms = (m) => Object.entries(m).filter(([, n]) => n > 0).map(([sp, n]) => ({ sp, n }));
  const joined = { left: toTerms(L), right: toTerms(R) };
  // ③ 両辺に共通する H₂O を相殺
  const cancelled = Math.min(L["H2O"] || 0, R["H2O"] || 0);
  if (cancelled > 0) { L["H2O"] -= cancelled; R["H2O"] -= cancelled; }
  const left = toTerms(L), right = toTerms(R);
  const hLeft = L["H+"] || 0, hRight = R["H+"] || 0;
  const res = { added, joined, left, right, need, k, neutralized, cancelled, hLeft, hRight };
  res.ok = k === need && need > 0 && hLeft === 0 && hRight === 0;
  if (res.ok) {
    res.reason = `できた！ H⁺ ${need}個が OH⁻ と結びついて H₂O になり、` +
      (cancelled > 0 ? `両辺に共通する H₂O ${cancelled}個 が消えた。` : `相殺する H₂O は無かった。`) +
      `これが塩基性条件の式。`;
  } else if (k < need) {
    res.reason = `H⁺ がまだ ${need - k}個 残っている。塩基性の水溶液に H⁺ はほとんど存在できないので、` +
      `あと ${need - k}個 OH⁻ を足そう。`;
  } else {
    res.reason = `${k - need}個 多い。相手のいない OH⁻ が両辺に ${k - need}個ずつ残ってしまう` +
      `（両辺に同じだけ残るなら、はじめから足さないのと同じ）。`;
  }
  return res;
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
  // 数合わせビューは**分子反応式**の項を粒に分解して組み替える。
  // 溶媒の水が式に入る反応では、ビーカーの試薬（stage.reactants）ではなく式の項を使う
  const eq = eqOf(stage);
  const pool = {};
  eq.reactants.forEach((sp, i) => {
    // PARTS は電離表・原子化表を含み、電離しない分子（NH₃ など）はそれ自身に分解される
    for (const ion of partsOf(stage, sp)) pool[ion] = (pool[ion] || 0) + (leftCoeffs[i] || 0);
  });
  // gasGroup がある場合、該当2項（H₂O と CO₂ など）は中間体1項に置き換えて計算し、
  // 結果を両項へ同数として展開する
  let prods = eq.products.slice();
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

/* 反応式パネルが扱う項。既定は投入する分子そのもの（分子反応式）だが、
   stage.ionic を持つステージでは**イオン反応式**にも切り替えられる。
   沈殿生成のように「傍観イオンを除くと本質が見える」反応では、そちらが標準的な書き方になる。
   ビーカーに入れる試薬（stage.reactants）とは別物であることに注意。 */
function eqOf(stage, mode) {
  if (mode === "ionic" && stage && stage.ionic) return stage.ionic;
  // 分子反応式が書けない反応（noMolecular に理由を持つ）は、モードによらずイオン反応式。
  // 「分子反応式の欄に何かそれらしい式を置く」ことをしないための分岐で、
  // 置いてしまうと NH₄Cl ⇄ NH₃ ＋ HCl のような**水の中では起きない式**が並ぶ
  if (stage && stage.noMolecular && stage.ionic) return stage.ionic;
  // 反応式に溶媒の水が現れる反応（弱塩基の電離を含むもの）は、
  // ビーカーに入れる試薬（reactants）と式の項が一致しないので molecular で上書きする
  if (stage && stage.molecular) return stage.molecular;
  return { reactants: stage.reactants, products: stage.products, answer: stage.answer };
}

/* coeffs: 反応物→生成物の順の係数配列。
   正否は模範との比較ではなく「原子数の保存＋最簡整数比」で判定する。
   電荷も compareSides が見ているので、イオン反応式でもそのまま判定できる。 */
function checkStageCoeffs(stage, coeffs, mode) {
  if (coeffs.some((c) => !Number.isInteger(c) || c < 1)) {
    return { ok: false, reason: "すべての係数を1以上の整数で入力してください" };
  }
  const eq = eqOf(stage, mode);
  // 項の数と係数の数が食い違うのは呼び出し側の取り違え（分子式とイオン反応式の混同）
  if (coeffs.length !== eq.reactants.length + eq.products.length) {
    return { ok: false, reason: "係数の数が反応式の項の数と合っていません" };
  }
  const left = eq.reactants.map((sp, i) => ({ sp, n: coeffs[i] }));
  const right = eq.products.map((sp, i) => ({ sp, n: coeffs[eq.reactants.length + i] }));
  const cmp = compareSides(left, right);
  if (!cmp.balanced) {
    // イオン反応式では電荷も合わせる必要がある（原子だけ合っていても不正解）
    return {
      ok: false, cmp,
      reason: cmp.rows.every((r) => r.ok) && !cmp.chargeOk
        ? `原子の数は合っているが、電荷が合っていない（左 ${cmp.chargeLeft} / 右 ${cmp.chargeRight}）。イオン反応式では電荷もそろえる`
        : "左右で原子の数が合っていません",
    };
  }
  const g = gcdAll(coeffs);
  if (g !== 1) {
    // 「最簡比にしよう」だけでは何をすればよいか分からないので、割る数と割った先まで示す
    return {
      ok: false, gcd: g, cmp,
      reason: `つり合っているけれど、係数がすべて ${g} で割り切れる。` +
        `${coeffs.join(" : ")} → ${coeffs.map((c) => c / g).join(" : ")} に直そう` +
        `（同じ反応を ${g} 回くり返し書いているのと同じ）`,
    };
  }
  return { ok: true, cmp };
}
