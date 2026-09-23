---
id: acid-displacement
unit: theo.acid-base
unitLabel: 酸と塩基
group: 弱酸の遊離
title: 弱酸の遊離・揮発性の酸の遊離 —— 陰イオンが H⁺ とくっつく
summary: 弱酸の塩に強酸を加えると弱酸が、弱塩基の塩に強塩基を加えると弱塩基が遊離します。原因は「弱酸の陰イオンが H⁺ とくっつきたがる」ことで、塩の加水分解と同じ仕組みです。不揮発性の酸で揮発性の酸を追い出す反応も同じ型で書けます。気体の製法の多くがここに入ります。
codes:
  - theo.acid-base.weak-acid-displacement
  - theo.acid-base.gas-by-displacement
  - theo.acid-base.weak-base-displacement
  - theo.acid-base.volatile-acid
source:
  - slides:無機の基本１「無機の前に復習すべきこと」p.24〜28・練習5 p.56〜58
  - slides:無機の基本５「ハロゲン」s16・s25
  - slides:無機の基本６「硫黄」s9・s13・s20・s24
  - textbook:R5化学 Vol.2 4編（弱塩基の遊離・CaCO₃ ＋ 2HCl・Na₂SiO₃ ＋ 2HCl）
singleSource: false
why: 遊離の反応は、無機の気体の製法（H₂S・SO₂・CO₂・NH₃・HCl・HF）に何度も出てくるが、どれも「弱酸（揮発性の酸）の陰イオンが H⁺ を受け取る」という1つの型で書ける。だから各気体のページで式を別々に覚えさせず、このページで型と書き方の手順を1回だけ見せ、気体ごとの性質は各ページへ一言とリンクで渡した。加水分解と同じ仕組みであることは、スライドの図解（無機の基本１ p.28）がそのまま示しているので、その図を中央に置いた。行と例はユーザー自身の講義スライド（無機の基本１・５・６）から取り、弱塩基の遊離と炭酸塩・ケイ酸塩の例は教科書で確かめた①のドラフト。
---

酢酸ナトリウムに塩酸を加えると、酢酸のにおいがしてきます。このように、**弱酸の塩に強酸を加えると弱酸が生じる**反応を**弱酸の遊離**といいます。無機の気体の製法の多くは、この反応の仲間です。塩の加水分解（前のページ）と同じ仕組みで説明できます。

:::link
to: salt
text: 塩の加水分解と「強い方が勝つ」は、塩のページへ
:::

:::section
anchor: weak-acid
title: 弱酸の遊離
lead: 弱酸の塩に強酸を加えると、弱酸が生じて強酸の塩が残ります。弱酸 ＋ 強塩基の塩 ＋ 強酸 → 弱酸 ＋ 強酸 ＋ 強塩基の塩。
terms:
- 弱酸の遊離
:::

具体例として、酢酸ナトリウムに塩酸を加えた反応を見ます。

:::reaction
left: CH₃COONa ＋ HCl
right: CH₃COOH ＋ NaCl
level: ★★★
note: 弱酸 ＋ 強塩基の塩　＋　強酸　→　弱酸　＋　強酸 ＋ 強塩基の塩
:::

HCl は強酸なのですべて電離して H⁺ を出し、CH₃COO⁻ がその H⁺ を受け取って CH₃COOH になります。反応の芯はこの1本です。

:::reaction
left: CH₃COO⁻ ＋ H⁺
right: CH₃COOH
level: ★★★
note: 酢酸の電離（CH₃COOH ⇄ CH₃COO⁻ ＋ H⁺）の逆向き。酢酸は電離度が 0.01 くらいで、平衡は CH₃COOH 側に大きく寄っているので、H⁺ を渡されればほぼすべて CH₃COOH になります。
:::

## 「強酸が強いから追い出す」のではない

弱酸の遊離は「強酸が強いから弱酸を追い出す」と説明されることがありますが、原因は逆側にあります。**弱酸の陰イオン（CH₃COO⁻）が H⁺ とくっつきたがる**ことが原因です。弱酸はほとんど電離しないので、H⁺ を渡されれば喜んで受け取って分子に戻ります。

「**酸・塩基は、あとから加えても強いものから反応する**」と覚えておきましょう。

:::section
anchor: gases
title: 弱酸の遊離で気体が出る反応
lead: 弱酸が気体（H₂S・CO₂・SO₂）なら、遊離した弱酸はそのまま気体として出ていきます。気体の実験室的製法の多くがこの型です。
terms:
- 実験室的製法
:::

弱酸が気体として出ていく反応は、気体の製法としてよく登場します。**どれも「弱酸 ＋ 塩基の塩」＋「強酸」の型**です。

:::reaction
left: FeS ＋ H₂SO₄
right: FeSO₄ ＋ H₂S↑
level: ★★★
note: 硫化鉄(Ⅱ)に希硫酸を加える。硫化水素の製法。S²⁻ ＋ 2H⁺ → H₂S が芯です。
:::

:::reaction
left: Na₂SO₃ ＋ H₂SO₄
right: Na₂SO₄ ＋ H₂O ＋ SO₂↑
level: ★★★
note: 亜硫酸ナトリウムに希硫酸を加える。二酸化硫黄の製法。遊離した H₂SO₃ は H₂O と SO₂ に分けて書きます。
:::

:::reaction
left: CaCO₃ ＋ 2HCl
right: CaCl₂ ＋ H₂O ＋ CO₂↑
level: ★★★
note: 石灰石に希塩酸を加える。二酸化炭素の製法。遊離した H₂CO₃ は H₂O と CO₂ に分けて書きます。
:::

:::reaction
left: Na₂SiO₃ ＋ 2HCl
right: 2NaCl ＋ H₂SiO₃
level: ★☆☆
note: ケイ酸ナトリウムの水溶液に塩酸を加えると、弱酸のケイ酸が白色ゲル状の沈殿として遊離します。
:::

H₂SO₃ と H₂CO₃ は気体の SO₂・CO₂ が出ていくので、右辺には **H₂O ＋ SO₂**、**H₂O ＋ CO₂** と分けて書きます。

**FeS ＋ H₂SO₄、Na₂SO₃ ＋ H₂SO₄、CaCO₃ ＋ 2HCl の3本は必ず書けるようにしてください。**反応物さえ覚えていれば、生成物と係数は型から出せます。

:::link
to: sulfur
text: 硫化水素・二酸化硫黄の性質は、硫黄のページへ
:::

:::link
to: carbon-silicon
text: 二酸化炭素とケイ酸の性質は、炭素とケイ素のページへ
:::

:::section
anchor: weak-base
title: 弱塩基の遊離
lead: 弱塩基の塩に強塩基を加えると、弱塩基が生じます。アンモニアの製法がこの型です。
terms:
- 弱塩基の遊離
:::

酸と塩基を入れ替えても同じことが起こります。弱塩基の塩（NH₄Cl）に強塩基を加えると、NH₄⁺ が OH⁻ に H⁺ を渡して NH₃ に戻ります。これを**弱塩基の遊離**といいます。

:::reaction
left: NH₄Cl ＋ NaOH
right: NaCl ＋ H₂O ＋ NH₃
level: ★★★
note: 強酸 ＋ 弱塩基の塩　＋　強塩基　→　強酸 ＋ 強塩基の塩　＋　弱塩基。芯は NH₄⁺ ＋ OH⁻ → NH₃ ＋ H₂O です。
:::

:::reaction
left: 2NH₄Cl ＋ Ca(OH)₂
over: 加熱
right: CaCl₂ ＋ 2H₂O ＋ 2NH₃↑
level: ★★★
note: 塩化アンモニウムと水酸化カルシウムの固体を混ぜて加熱する。アンモニアの実験室的製法です。
:::

:::link
to: nitrogen
text: アンモニアの性質と捕集は、窒素のページへ
:::

:::section
anchor: same-mechanism
title: 遊離と加水分解は同じ仕組み
lead: 弱酸の遊離も、弱酸の塩の加水分解も、弱酸の陰イオンが H⁺ とくっつく「弱酸の電離の逆反応」です。H⁺ をくれる相手が強酸か水かだけが違います。
terms:
- 加水分解
:::

:::figure
src: acid-displacement-hydrolysis.png
alt: 左は CH₃COONa の水溶液に HCl を加えると、HCl がすべて電離して H⁺ を渡し CH₃COOH が遊離する様子。右は CH₃COONa の水溶液で、CH₃COO⁻ が水を分解して H⁺ を受け取り、OH⁻ が余って塩基性になる様子。下に両方の反応式
caption: **弱酸の遊離も加水分解も、CH₃COO⁻ が H⁺ とくっつく反応**。H⁺ をくれるのが HCl なら遊離（ほぼ 100 ％進む）、H₂O なら加水分解（ごく一部しか起こらない可逆反応）です。
:::

どちらも、**弱酸の電離の逆反応 CH₃COO⁻ ＋ H⁺ → CH₃COOH** が芯です。違うのは H⁺ をくれる相手だけです。

:::list
items:
- H⁺ をくれるのが **強酸 HCl** → 楽に H⁺ が手に入るので、ほぼ 100 ％進む（**弱酸の遊離**）
- H⁺ をくれるのが **水 H₂O** → 水を分解して H⁺ をとるのは大変なので、ごく一部しか起こらない可逆反応（**加水分解**）
:::

## 式の書き方（どちらも同じ手順）

:::list
ordered: true
items:
- 弱酸（弱塩基）の電離の逆反応の式を書く。
　CH₃COO⁻ ＋ H⁺ → CH₃COOH
- H⁺（OH⁻）を供給した物質の、残りのイオンを両辺に足す。
　HCl が供給したなら両辺に Cl⁻、H₂O が供給したなら両辺に OH⁻
- 陰イオン（陽イオン）がもともと塩だったなら、その相手のイオンも両辺に足す。
　CH₃COONa だったなら両辺に Na⁺
- 両辺のイオンを組んで、物質の式にする。
:::

具体例として、硫化鉄(Ⅱ)と硫酸でなぞると、S²⁻ ＋ 2H⁺ → H₂S の両辺に、H⁺ をくれた硫酸の SO₄²⁻ と、S²⁻ の相手だった Fe²⁺ を足して、FeS ＋ H₂SO₄ → FeSO₄ ＋ H₂S となります。

:::link
to: salt
text: 加水分解の式（CH₃COO⁻・HCO₃⁻・NH₄⁺）は、塩のページへ
:::

:::section
anchor: volatile
title: 揮発性の酸の遊離
lead: 揮発性の酸（HCl・HF など）の塩に、不揮発性の酸（濃硫酸）を加えて加熱すると、揮発性の酸が気体として出ていきます。
terms:
- 揮発性の酸
- 不揮発性の酸
:::

濃硫酸は沸点が高く、蒸発しにくい**不揮発性の酸**です。これに対して HCl・HF・HNO₃ は蒸発しやすい**揮発性の酸**です。揮発性の酸の塩に濃硫酸を加えて加熱すると、揮発性の酸が気体となって出ていくので、反応が進みます。

:::reaction
left: NaCl ＋ H₂SO₄
over: 加熱
right: NaHSO₄ ＋ HCl↑
level: ★★★
note: 揮発性の酸 ＋ 塩基の塩　＋　不揮発性の酸　→　不揮発性の酸 ＋ 塩基の塩　＋　揮発性の酸。塩化水素の製法です。
:::

:::reaction
left: CaF₂ ＋ H₂SO₄
over: 加熱
right: CaSO₄ ＋ 2HF↑
level: ★★★
note: ホタル石に濃硫酸を加えて加熱する。フッ化水素の製法です。HF は弱酸でもあるので、弱酸の遊離とも読めます。
:::

:::callout
tone: caution
text: NaCl と濃硫酸の反応でできるのは Na₂SO₄ ではなく NaHSO₄ です。ふつうの加熱では、硫酸の2段目の電離が起こりにくく、1段目の H⁺ しか渡さないためです。
:::

「**濃硫酸が登場する反応は加熱が必要**」と覚えておきましょう。

:::table
caption: 遊離の型のまとめ
source: このページの反応式（無機の基本１ p.24・練習5、無機の基本５ s16・s25、無機の基本６ s9・s13、教科書の CaCO₃・Na₂SiO₃）を型ごとに並べた
head:
- 型
- 塩
- 加えるもの
- 出てくるもの
align: left | left | left | left
rows:
- 弱酸の遊離 | CH₃COONa | 塩酸 | CH₃COOH
- 弱酸の遊離 | FeS | 希硫酸 | H₂S（気体）
- 弱酸の遊離 | Na₂SO₃ | 希硫酸 | SO₂（気体）＋ H₂O
- 弱酸の遊離 | CaCO₃ | 希塩酸 | CO₂（気体）＋ H₂O
- 弱塩基の遊離 | NH₄Cl | NaOH・Ca(OH)₂ | NH₃（気体）＋ H₂O
- 揮発性の酸の遊離 | NaCl | 濃硫酸（加熱） | HCl（気体）
- 揮発性の酸の遊離 | CaF₂ | 濃硫酸（加熱） | HF（気体）
:::

:::link
to: sulfuric-acid
text: 濃硫酸の不揮発性・酸化力・脱水作用は、硫酸のページへ
:::

:::link
to: chlorine
text: 塩化水素の性質と捕集は、塩素と塩化水素のページへ
:::

:::link
to: halogen
text: フッ化水素の性質（弱酸・ガラスを溶かす）は、ハロゲンのページへ
:::

:::link
to: gas-preparation
text: 気体の製法・捕集・乾燥を横に並べた早見表へ
:::

:::link
app: ion-equation/index
id: s10
text: 亜硫酸ナトリウム × 塩酸（気体発生）
:::

:::link
app: ion-equation/portal
id: u-gas
text: 気体の発生・弱酸の遊離
:::

:::heading
title: 硝酸を実験室でつくる
advanced: true
:::

硝酸も揮発性の酸なので、塩化水素と同じ型でつくれます。教科書は硝酸の製法として工業的なオストワルト法だけを載せています。

:::reaction
left: NaNO₃ ＋ H₂SO₄
over: 加熱
right: NaHSO₄ ＋ HNO₃
level: ★☆☆
note: 硝酸ナトリウムに濃硫酸を加えて加熱すると、揮発性の硝酸が蒸気になって出てきます（冷やして液体にする）。
:::

## 例題

紙に書いて解いてみてください。答え合わせは「解答を見る」から。

:::exercise
source: slides:無機の基本１ p.56〜58「練習5」。⚠ スライドの (3) は「硫化鉄(Ⅱ)水溶液」だが FeS は水に溶けないので「硫化鉄(Ⅱ)に」とした。解説の途中式の誤記（(2) の右辺 HCl、(4) の左辺 NaOH）は直して書いた
prompt: 次の変化を化学反応式で書け。(1) 酢酸ナトリウム水溶液に塩酸を加えた　(2) 塩化アンモニウム水溶液に水酸化ナトリウム水溶液を加えた　(3) 硫化鉄(Ⅱ)に希硫酸を加えた　(4) 塩化アンモニウムと水酸化カルシウムを混合して加熱した
answer: (1) CH₃COO⁻ ＋ H⁺ → CH₃COOH の両辺に Na⁺ と Cl⁻ を足して **CH₃COONa ＋ HCl → CH₃COOH ＋ NaCl**　(2) NH₄⁺ ＋ OH⁻ → NH₃ ＋ H₂O の両辺に Cl⁻ と Na⁺ を足して **NH₄Cl ＋ NaOH → NaCl ＋ H₂O ＋ NH₃**　(3) S²⁻ ＋ 2H⁺ → H₂S の両辺に Fe²⁺ と SO₄²⁻ を足して **FeS ＋ H₂SO₄ → FeSO₄ ＋ H₂S**　(4) 2NH₄⁺ ＋ 2OH⁻ → 2NH₃ ＋ 2H₂O の両辺に 2Cl⁻ と Ca²⁺ を足して **2NH₄Cl ＋ Ca(OH)₂ → CaCl₂ ＋ 2H₂O ＋ 2NH₃**
:::

:::exercise
source: ①ドラフトのために起こした「物質名から反応式を書く」問い（このページの ★★★ の式）
prompt: 次の変化を化学反応式で書け。(1) 亜硫酸ナトリウムに希硫酸を加えた　(2) 石灰石（CaCO₃）に希塩酸を加えた　(3) 塩化ナトリウムに濃硫酸を加えて加熱した
answer: (1) **Na₂SO₃ ＋ H₂SO₄ → Na₂SO₄ ＋ H₂O ＋ SO₂**（遊離した H₂SO₃ を H₂O と SO₂ に分ける）　(2) **CaCO₃ ＋ 2HCl → CaCl₂ ＋ H₂O ＋ CO₂**　(3) **NaCl ＋ H₂SO₄ → NaHSO₄ ＋ HCl**（Na₂SO₄ ではない）
:::
