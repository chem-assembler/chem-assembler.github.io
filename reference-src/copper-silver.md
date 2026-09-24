---
id: copper-silver
unit: inorg.metal
unitLabel: 金属元素
group: 銅と銀
title: 銅と銀 —— 酸化力のある酸に溶ける金属
summary: 11族の銅と銀の単体（酸化力のある酸との反応・銀樹）と、Cu²⁺・Ag⁺ の沈殿と錯イオン、ハロゲン化銀の色と感光性のまとめです。
codes:
  - inorg.metal.copper-oxidizing-acid
  - inorg.metal.silver-tree
  - inorg.metal.copper-ion
  - inorg.metal.copper-sulfate-hydrate
  - inorg.metal.silver-ion
  - inorg.metal.silver-halide
source:
  - textbook:R5化学Vol.2-4編4章（銅・銀の単体と化合物、Cu²⁺・Ag⁺ の反応、ハロゲン化銀）
  - ion:REDOX_STAGES r2・rn1・rn2（銀樹、銅と希硝酸・濃硝酸）
  - ion:STAGES cu-nh3-step1/2・complex-ag-nh3・complex-agcl-nh3（アンミン錯イオン）
  - muki:separation-model.js（Cu²⁺・Ag⁺ の沈殿と、過剰の NH₃・NaOH で溶けるかどうか）
  - muki:chemistry.js（Ag₂O 褐色・Cu(OH)₂ 青白色・CuS/Ag₂S 黒色）
singleSource: false
why: 銅と銀は、イオン化傾向が H₂ より小さいので塩酸・希硫酸には溶けず、硝酸・熱濃硫酸（酸化力のある酸）には溶ける、という同じ筋で単体の反応が書けるので、1ページにまとめて単体の節を共通にした。イオンの節は、Cu²⁺ と Ag⁺ を「少量の塩基 → 過剰の NH₃」「S²⁻」「Cl⁻」の順に並べ、どちらも過剰のアンモニア水で錯イオンになって溶ける（系統分離で Fe³⁺・Al³⁺ と分かれる根拠）ことが同じ形で見えるようにした。ハロゲン化銀は、ハロゲンの比較のページが持つべき話と重なるので、色・溶けやすさ・感光性を1つの表にとどめた。図はイオンでみる化学反応式の画面の切り取り。
---

銅 Cu と銀 Ag は、周期表の11族の遷移元素です。どちらも電気や熱をよく通し（銀が金属の中で最大、銅が2番目）、展性・延性に富みます。

:::section
anchor: element
title: 単体 —— 塩酸には溶けず、硝酸・熱濃硫酸に溶ける
lead: 銅と銀はイオン化傾向が H₂ より小さいので、H⁺ では酸化されません。酸化力のある酸（硝酸・熱濃硫酸）なら溶けます。
terms:
- 酸化力のある酸
- 緑青
- 電解精錬
:::

塩酸や希硫酸の酸化剤は H⁺ です。銅や銀は**イオン化傾向が H₂ より小さい**ので、H⁺ に e⁻ を渡すことができず、溶けません。

硝酸と熱濃硫酸には、H⁺ よりも強い酸化剤（NO₃⁻・H₂SO₄ の分子）が含まれているので、銅や銀も溶けます。発生する気体は**水素ではなく**、酸化剤が還元されてできた NO・NO₂・SO₂ です。

:::reaction
left: 3Cu ＋ 8HNO₃
right: 3Cu(NO₃)₂ ＋ 4H₂O ＋ 2NO
level: ★★★
note: 希硝酸。無色の NO が発生します。
:::

:::reaction
left: Cu ＋ 4HNO₃
right: Cu(NO₃)₂ ＋ 2H₂O ＋ 2NO₂
level: ★★★
note: 濃硝酸。赤褐色の NO₂ が発生します。
:::

:::reaction
left: Cu ＋ 2H₂SO₄
over: 加熱
right: CuSO₄ ＋ 2H₂O ＋ SO₂
level: ★★★
note: 熱濃硫酸。SO₂ が発生します。
:::

この3本は、銅の半反応式 Cu → Cu²⁺ ＋ 2e⁻ と、酸化剤（希硝酸・濃硝酸・熱濃硫酸）の半反応式を組み合わせれば出てきます。**反応物と生成物（何の気体が出るか）は暗記し、係数は半反応式から出す**ようにしましょう。

:::link
app: ion-equation/redox
id: rn1
text: 銅と希硝酸（無色の NO が発生）
:::

:::link
app: ion-equation/redox
id: rn2
text: 銅と濃硝酸（赤褐色の NO₂ が発生）
:::

:::link
to: redox-equation
text: 半反応式を組み合わせて全体の式にする手順は酸化還元反応式のページへ
:::

銀も同じように硝酸に溶けます。

:::reaction
left: 3Ag ＋ 4HNO₃
right: 3AgNO₃ ＋ 2H₂O ＋ NO
level: ★★☆
note: 希硝酸。濃硝酸なら Ag ＋ 2HNO₃ → AgNO₃ ＋ H₂O ＋ NO₂。
:::

:::mistake
wrong: 銅や銀は酸に溶けない。
right: 塩酸・希硫酸には溶けませんが、**硝酸・熱濃硫酸には溶けます**。
why: 塩酸・希硫酸の酸化剤は H⁺ だけですが、硝酸・熱濃硫酸は H⁺ より強い酸化剤をもつためです。このとき出る気体は H₂ ではありません。
:::

## 銀樹 —— イオン化傾向の差で析出する

硝酸銀水溶液に銅線を入れると、銅が溶けて水溶液が青くなり、銅線の表面に銀が樹の枝のように析出します（**銀樹**）。

:::reaction
left: Cu ＋ 2Ag⁺
right: Cu²⁺ ＋ 2Ag
level: ★★★
note: Cu は e⁻ を2個出し、Ag⁺ は1個ずつ受け取るので、Ag⁺ は2個要ります。
:::

:::figure
src: copper-silver-app-silver-tree.png
shot: url=/ion-equation/redox.html?rxn=r2 sel=#schematicWrap 状態=「＋ Ag⁺（酸化剤）」を1回押して Ag⁺ を2個にしたところ
alt: 模式図。左に Cu が1個、そこから e⁻ が2個それぞれ矢印で右の Ag⁺ 2個へ移っている。下に「Ag⁺ 2個と Cu 1個でちょうど反応する」とある
caption: Cu 1個が出す e⁻ は2個、Ag⁺ 1個が受け取る e⁻ は1個なので、**Cu 1個に Ag⁺ が2個**です。
:::

:::link
app: ion-equation/redox
id: r2
text: 銅と銀イオン（銀樹）
:::

:::link
to: ionization-tendency
text: 金属樹とイオン化列はイオン化傾向のページへ
:::

## 銅の単体の性質と製法

銅は赤色の光沢をもつ金属です。湿った空気中では、表面に**緑青**と呼ばれる青緑色のさびができます。空気中で加熱すると黒色の酸化銅(Ⅱ) CuO になり、さらに高温（約 1000℃ 以上）では赤色の酸化銅(Ⅰ) Cu₂O になります。

:::reaction
left: 2Cu ＋ O₂
over: 加熱
right: 2CuO
level: ★★☆
note: 黒色。
:::

銅は黄銅鉱（主成分 CuFeS₂）から粗銅をつくり、**電解精錬**で純度を上げます。黄銅（Cu と Zn）・青銅（Cu と Sn）などの合金にも使われます。

:::link
to: electrolysis-industry
text: 銅の電解精錬の陽極・陰極の式は電気分解の工業的利用のページへ
:::

:::section
anchor: cu-ion
title: Cu²⁺ の反応 —— 青白色の沈殿と深青色の錯イオン
lead: Cu²⁺ は青色。少量の塩基で青白色の Cu(OH)₂、過剰のアンモニア水で深青色の [Cu(NH₃)₄]²⁺、H₂S で黒色の CuS。
terms:
- 硫酸銅(Ⅱ)五水和物
- テトラアンミン銅(Ⅱ)イオン
:::

硫酸銅(Ⅱ)五水和物 CuSO₄・5H₂O は青色の結晶で、加熱すると水和水を失って白色の無水物 CuSO₄ になります。無水物は水を吸うと青色にもどるので、水の検出に使われます。

:::reaction
left: Cu²⁺ ＋ 2OH⁻
right: Cu(OH)₂↓
level: ★★★
note: 青白色の沈殿。NaOH 水溶液でもアンモニア水（少量）でも同じです。
:::

:::reaction
left: Cu(OH)₂
over: 加熱
right: CuO ＋ H₂O
level: ★★☆
note: 青白色の沈殿を加熱すると、黒色の CuO になります。
:::

:::reaction
left: Cu(OH)₂ ＋ 4NH₃
right: [Cu(NH₃)₄]²⁺ ＋ 2OH⁻
level: ★★★
note: 過剰のアンモニア水。深青色の水溶液になります。
:::

:::reaction
left: Cu²⁺ ＋ S²⁻
right: CuS↓
level: ★★★
note: 黒色の沈殿。酸性の水溶液でも沈殿します。
:::

:::link
app: ion-equation
id: cu-nh3-step1
text: 硫酸銅とアンモニア水（少量：沈殿）
:::

:::link
app: ion-equation
id: cu-nh3-step2
text: 水酸化銅(Ⅱ)とアンモニア水（過剰：再溶解）
:::

Cu(OH)₂ は、過剰の NaOH 水溶液には溶けません（両性ではないため）。Cu の炎色反応は**青緑色**です。

## 例題 —— Cu²⁺ の反応

:::exercise
source: 自作（このページの ★★★ の式を物質名から書く）
prompt: 次の変化を化学反応式またはイオン反応式で書け。**(1) 銅に希硝酸を加えた　(2) 銅に濃硫酸を加えて加熱した　(3) 硝酸銀水溶液に銅線を入れた（イオン反応式）　(4) 硫酸銅(Ⅱ) 水溶液に少量のアンモニア水を加えてできた沈殿に、さらにアンモニア水を加えると溶けた（(4) は沈殿が溶ける反応のイオン反応式）**
answer: (1) 3Cu ＋ 8HNO₃ → 3Cu(NO₃)₂ ＋ 4H₂O ＋ 2NO　(2) Cu ＋ 2H₂SO₄ → CuSO₄ ＋ 2H₂O ＋ SO₂　(3) Cu ＋ 2Ag⁺ → Cu²⁺ ＋ 2Ag　(4) Cu(OH)₂ ＋ 4NH₃ → [Cu(NH₃)₄]²⁺ ＋ 2OH⁻
:::

:::section
anchor: ag-ion
title: Ag⁺ の反応とハロゲン化銀
lead: Ag⁺ は少量の塩基で褐色の Ag₂O、Cl⁻ で白色の AgCl。どちらも過剰のアンモニア水で [Ag(NH₃)₂]⁺ になって溶けます。
terms:
- 酸化銀
- ジアンミン銀(Ⅰ)イオン
- ハロゲン化銀
- 感光性
:::

銀イオンは OH⁻ と結びつくと、水酸化物ではなく**酸化銀 Ag₂O** の褐色沈殿になります。AgOH は不安定で、すぐに水がとれるためです。

:::reaction
left: 2Ag⁺ ＋ 2OH⁻
right: Ag₂O↓ ＋ H₂O
level: ★★★
note: 褐色の沈殿。過剰の NaOH には溶けません。
:::

:::reaction
left: Ag₂O ＋ 4NH₃ ＋ H₂O
right: 2[Ag(NH₃)₂]⁺ ＋ 2OH⁻
level: ★★☆
note: 過剰のアンモニア水で溶けます。無色です。
:::

:::reaction
left: Ag⁺ ＋ Cl⁻
right: AgCl↓
level: ★★★
note: 白色の沈殿。Cl⁻ の検出に使います。
:::

:::reaction
left: AgCl ＋ 2NH₃
right: [Ag(NH₃)₂]⁺ ＋ Cl⁻
level: ★★★
note: AgCl はアンモニア水に溶けます。
:::

:::link
app: ion-equation
id: complex-agcl-nh3
text: 塩化銀とアンモニア（沈殿の再溶解）
:::

:::table
caption: ハロゲン化銀の色と溶けやすさ
source: 教科書 R5化学 Vol.2 4編で確かめた事実（色・水への溶けやすさ・アンモニア水への溶けやすさ）を、F〜I の順に並べたもの
head:
- ハロゲン化銀
- 色
- 水
- アンモニア水
align: center | left | left | left
rows:
- AgF | —— | 溶ける | ——
- AgCl | **白色** | 溶けない（沈殿） | 溶ける
- AgBr | **淡黄色** | 溶けない（沈殿） | 少し溶ける
- AgI | **黄色** | 溶けない（沈殿） | 溶けない
:::

AgF だけが水に溶けることは、Ag⁺ と F⁻ の組だけが沈殿しない例外として覚えておきましょう。ハロゲン化銀は光で分解して銀を遊離します（**感光性**）。この性質は写真のフィルムに使われてきました。

:::reaction
left: 2AgBr
over: 光
right: 2Ag ＋ Br₂
level: ★★☆
:::

Ag⁺ は、S²⁻ と黒色の Ag₂S（酸性でも沈殿）、クロム酸イオン CrO₄²⁻ と赤褐色の Ag₂CrO₄ の沈殿もつくります。

:::link
to: halogen
text: ハロゲンの単体・ハロゲン化水素との比較はハロゲンのページへ
:::

:::link
to: precipitate
text: 陰イオンごとに沈む相手の一覧は沈殿の生成と色のページへ
:::

アンモニア性硝酸銀水溶液（[Ag(NH₃)₂]⁺ を含む水溶液）は、アルデヒドの検出（**銀鏡反応**）に使われます。[Ag(NH₃)₂]⁺ が還元されて、銀が試験管の内壁に析出します。

:::link
to: aldehyde
text: 銀鏡反応はアルデヒドのページへ
:::

## 例題 —— Ag⁺ の反応とハロゲン化銀

:::exercise
source: 自作（ハロゲン化銀の表を使って沈殿を見分ける）
prompt: 硝酸銀水溶液に、ある水溶液を加えると淡黄色の沈殿が生じた。この沈殿はアンモニア水にわずかに溶けた。加えた水溶液に含まれていた陰イオンは何か。
answer: **臭化物イオン Br⁻** です。沈殿は AgBr（淡黄色）です。AgCl なら白色でアンモニア水によく溶け、AgI なら黄色でアンモニア水に溶けません。
:::

:::section
anchor: range
title: 覚える範囲
lead: 銅と酸化力のある酸の3本、銀樹、Cu²⁺ と Ag⁺ の沈殿と錯イオンの式、ハロゲン化銀の色です。
:::

## 必ず覚えるもの（★★★）

:::list
items:
- 銅と希硝酸・濃硝酸・熱濃硫酸（何の気体が出るか）
- Cu ＋ 2Ag⁺ → Cu²⁺ ＋ 2Ag（銀樹）
- Cu²⁺ → Cu(OH)₂（青白色）→ 過剰の NH₃ で [Cu(NH₃)₄]²⁺（深青色）。CuS は黒色
- Ag⁺ → Ag₂O（褐色）。Ag⁺ ＋ Cl⁻ → AgCl（白色）→ NH₃ で [Ag(NH₃)₂]⁺
- AgCl 白・AgBr 淡黄・AgI 黄
:::

Cu₂O（赤色）・緑青・黄銅鉱の化学式は、見て分かれば十分です。銀と硝酸の式は、銅の式と同じ組み立て方で書けるので、個別に暗記しなくても構いません。
