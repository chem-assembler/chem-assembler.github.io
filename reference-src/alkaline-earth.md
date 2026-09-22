---
id: alkaline-earth
unit: inorg.metal
unitLabel: 金属元素
group: 2族元素
title: 2族元素 —— マグネシウム・カルシウム・バリウム
summary: 2族の単体の反応と、カルシウムの化合物（石灰石・生石灰・消石灰・セッコウ）のつながり、硫酸塩と炭酸塩の沈殿のまとめです。
codes:
  - inorg.metal.alkaline-earth-def
  - inorg.metal.mg-vs-ca
  - inorg.metal.calcium-compounds
  - inorg.metal.limewater-co2
  - inorg.metal.barium-sulfate
  - inorg.metal.gypsum
source:
  - textbook:R5化学Vol.2-4編3章（アルカリ土類金属の単体・化合物・炎色・焼きセッコウの組成）
  - slides:無機の基本６「硫黄」s22（Ba²⁺・Ca²⁺ と SO₄²⁻ の沈殿 ★★★、セッコウ ★☆☆）
  - muki:chemistry.js（BaSO₄・CaSO₄・BaCO₃・CaCO₃ の沈殿の色、CaSO₄ がよく溶ける注記）
  - ion:STAGES s5・s8（塩化バリウムと硫酸ナトリウム、硫酸と水酸化バリウム）
singleSource: false
why: 2族で問われるのは、Mg と Ca・Sr・Ba の性質の違い（水との反応・水酸化物の強さ・硫酸塩の溶けやすさ・炎色）と、カルシウムの化合物が CO₂ と水の出入りで次々に変わっていくつながりの2つなので、節をその2つに割り、前者は表1枚、後者は5本の式を「石灰石から始めて石灰石にもどる」順に並べた。硫酸塩の沈殿は無機の基本６ s22 が ★★★ を付けているので本文に置き、セッコウの水和物の式は同じスライドの ★☆☆ にそろえた。Be・Mg をアルカリ土類金属に含めるかは課程の改訂で扱いが変わったので、本文は新しい扱いで書き、注意の囲みを1つ置いた。図はイオンでみる化学反応式の画面の切り取り。
---

周期表の2族の元素（Be・Mg・Ca・Sr・Ba・Ra）を**アルカリ土類金属**といいます。原子は価電子を2個もち、**2価の陽イオン**になりやすい元素です。

:::callout
tone: caution
text: 以前は Be と Mg をアルカリ土類金属に含めない扱いがありました。いまは2族の6元素すべてをアルカリ土類金属と呼びます。ただし Be・Mg は Ca・Sr・Ba と性質が少し違うので、下の表では Mg を分けて並べます。
:::

:::link
to: alkali-metal
text: 1族（アルカリ金属）の単体と化合物はアルカリ金属のページへ
:::

:::section
anchor: element
title: 単体の性質 —— Mg と Ca・Sr・Ba の違い
lead: Ca・Sr・Ba は常温の水と反応しますが、Mg は熱水とでないと反応しません。水酸化物・硫酸塩・炎色でも Mg だけが違います。
terms:
- アルカリ土類金属
- 炎色反応
:::

:::table
caption: マグネシウムと、カルシウム・ストロンチウム・バリウムの比較
source: 教科書 R5化学 Vol.2 4編3章で確かめた事実（水との反応・炎色・水酸化物と硫酸塩の溶けやすさ）を、Mg と Ca・Sr・Ba の2列に分けて並べたもの。沈殿の色は muki:chemistry.js と同じ語
head:
- 観点
- Mg
- Ca・Sr・Ba
align: left | left | left
rows:
- 水との反応 | 常温ではほとんど反応しない。**熱水**と反応する | **常温の水**と反応して H₂ を出す
- 炎色反応 | 示さない | Ca **橙赤色**・Sr **紅色**・Ba **黄緑色**
- 水酸化物 | Mg(OH)₂ は水に溶けにくく、**弱塩基** | Ca(OH)₂・Ba(OH)₂ は水に溶け、**強塩基**
- 硫酸塩 | MgSO₄ は水に溶ける | CaSO₄・BaSO₄ は水に溶けにくい（**白色沈殿**）
- 炭酸塩 | MgCO₃ は水に溶けにくい | CaCO₃・BaCO₃ も水に溶けにくい（**白色沈殿**）
:::

**「Mg だけ仲間はずれ」と覚えてください。**水との反応・炎色・水酸化物の強さ・硫酸塩の溶けやすさの4つで、Mg は Ca・Sr・Ba と逆の側に入ります。炭酸塩だけは、どれも水に溶けません。

反応性は Ca ＜ Sr ＜ Ba の順に大きくなります。アルカリ金属と同じく、原子が大きいほど最外殻の電子が原子核から遠く、**電子を放出しやすいため**です。ただし2個の電子を出す必要があるので、同じ周期のアルカリ金属よりはおだやかです。

## 水・酸・酸素との反応

カルシウムは常温の水と反応して水素を出し、水酸化カルシウムになります。ナトリウムと同じ型の酸化還元反応です。

:::reaction
left: Ca ＋ 2H₂O
right: Ca(OH)₂ ＋ H₂
level: ★★★
note: 2価なので、Na のときと違って Ca 1個に H₂O が2個です。
:::

:::reaction
left: Mg ＋ 2H₂O
over: 熱水
right: Mg(OH)₂ ＋ H₂
level: ★★☆
:::

マグネシウムは空気中で点火すると、強い光を出して燃えます。希塩酸にはよく溶けて水素を出します。

:::reaction
left: 2Mg ＋ O₂
right: 2MgO
level: ★★☆
:::

:::reaction
left: Mg ＋ 2HCl
right: MgCl₂ ＋ H₂
level: ★★☆
note: イオン化傾向が H₂ より大きい金属と、酸の H⁺ の反応です。
:::

:::link
to: ionization-tendency
text: 水や酸と反応する金属の境目はイオン化傾向のページへ
:::

:::section
anchor: calcium
title: カルシウムの化合物 —— 石灰石から始めて石灰石にもどる
lead: CaCO₃ → CaO → Ca(OH)₂ → CaCO₃ → Ca(HCO₃)₂ と、CO₂ と水の出入りだけで次々に変わります。
terms:
- 石灰石
- 生石灰
- 消石灰
- 石灰水
- 炭酸水素カルシウム
:::

:::table
caption: カルシウムの化合物の呼び名
source: 教科書 R5化学 Vol.2 4編3章で確かめた別名と用途を、下の反応の順に並べたもの
head:
- 化学式
- 名前
- 別名・主な形
- 性質・用途
align: left | left | left | left
rows:
- CaCO₃ | 炭酸カルシウム | 石灰石・大理石・貝殻 | 水に溶けにくい。セメントの原料
- CaO | 酸化カルシウム | **生石灰** | 水と反応して発熱する。乾燥剤・発熱剤
- Ca(OH)₂ | 水酸化カルシウム | **消石灰**（飽和水溶液は**石灰水**） | 強塩基。しっくい・土壌の中和
- Ca(HCO₃)₂ | 炭酸水素カルシウム | —— | 水に溶ける（水溶液中で Ca²⁺ と HCO₃⁻）
- CaCl₂ | 塩化カルシウム | —— | 水に溶ける。乾燥剤
:::

5本の式を、石灰石を焼くところから順に見ていきます。

:::list
ordered: true
items:
- 石灰石を強く加熱すると、CO₂ が抜けて生石灰になる。
　CaCO₃ → CaO ＋ CO₂
- 生石灰に水を加えると、発熱して消石灰になる。
　CaO ＋ H₂O → Ca(OH)₂
- 石灰水に CO₂ を通じると、CaCO₃ の白色沈殿ができて白濁する。
　Ca(OH)₂ ＋ CO₂ → CaCO₃ ＋ H₂O
- さらに CO₂ を通じ続けると、沈殿が溶けて無色透明にもどる。
　CaCO₃ ＋ CO₂ ＋ H₂O → Ca(HCO₃)₂
- 炭酸カルシウムに塩酸を加えると、CO₂ が発生する（弱酸の遊離）。
　CaCO₃ ＋ 2HCl → CaCl₂ ＋ H₂O ＋ CO₂
:::

:::reaction
left: CaCO₃
over: 強熱
right: CaO ＋ CO₂
level: ★★★
:::

:::reaction
left: CaO ＋ H₂O
right: Ca(OH)₂
level: ★★★
note: 塩基性酸化物と水の反応。多量の熱が出ます。
:::

:::reaction
left: Ca(OH)₂ ＋ CO₂
right: CaCO₃↓ ＋ H₂O
level: ★★★
note: CO₂ の検出反応です（石灰水の白濁）。
:::

:::reaction
left: CaCO₃ ＋ CO₂ ＋ H₂O
arrow: ⇄
right: Ca(HCO₃)₂
level: ★★★
note: 加熱したり CO₂ が抜けたりすると左へもどり、CaCO₃ が再び沈殿します。
:::

:::reaction
left: CaCO₃ ＋ 2HCl
right: CaCl₂ ＋ H₂O ＋ CO₂
level: ★★★
note: 実験室で CO₂ をつくるときの反応です。
:::

④ の式が左右どちらにも進むことで、**鍾乳洞**ができます。CO₂ を含む雨水が石灰岩を溶かして地下に空洞をつくり（右向き）、しみ出した水から CO₂ が抜けると CaCO₃ が再び析出して鍾乳石や石筍になります（左向き）。

:::mistake
wrong: 白濁した石灰水に CO₂ を通じ続けると、沈殿がさらに増えて白濁が濃くなる。
right: CO₂ を通じ続けると、CaCO₃ は炭酸水素カルシウム Ca(HCO₃)₂ になって**溶け、無色透明にもどります**。
why: 炭酸水素カルシウムは水に溶けるためです。有機の元素の確認でも、この「白濁してから透明にもどる」が出てきます。
:::

:::link
to: element-detection
text: 石灰水の白濁で炭素を確かめる操作は元素の確認のページへ
:::

:::link
to: acid-displacement
text: 炭酸塩に強酸を加えて CO₂ が出る理由は弱酸の遊離のページへ
:::

:::section
anchor: sulfate
title: 硫酸塩と炭酸塩 —— 沈殿でイオンを見分ける
lead: Ba²⁺ と Ca²⁺ は SO₄²⁻ や CO₃²⁻ と白色沈殿をつくります。Mg²⁺ は SO₄²⁻ とは沈殿しません。
terms:
- 硫酸バリウム
- セッコウ
- 焼きセッコウ
:::

硫酸イオン SO₄²⁻ は、Ba²⁺・Ca²⁺・Pb²⁺ と白色の沈殿をつくります。電荷が合うようにイオンを組み合わせれば、式はそのまま書けます。

:::reaction
left: Ba²⁺ ＋ SO₄²⁻
right: BaSO₄↓
level: ★★★
note: 白色沈殿。水にも酸にも溶けません。
:::

:::reaction
left: Ca²⁺ ＋ SO₄²⁻
right: CaSO₄↓
level: ★★★
note: 白色沈殿。ただし BaSO₄ よりはよく溶けるので、うすい溶液では沈殿しないことがあります。
:::

:::figure
src: alkaline-earth-app-baso4.png
shot: url=/ion-equation/?rxn=s5 sel=svg#beaker 状態=係数を 1・1・1・2 に合わせて「▶ 係数どおりに再生」を押し、12秒待ってから撮影
alt: ビーカーの模式図。Ba²⁺ と SO₄²⁻ が組になって底に沈み、Na⁺ 2個と Cl⁻ 2個は水中に残っている
caption: BaCl₂ ＋ Na₂SO₄ の反応のあと。**Ba²⁺ と SO₄²⁻ だけが組になって底に沈み**、Na⁺ と Cl⁻ はイオンのまま残ります。
:::

:::link
app: ion-equation
id: s5
text: 塩化バリウムと硫酸ナトリウム（沈殿）
:::

:::link
app: ion-equation
id: s8
text: 硫酸と水酸化バリウム（中和＋沈殿）
:::

硫酸バリウムは、胃や腸の**X線造影剤**に使われます。バリウムのイオンは体に有害ですが、BaSO₄ は水にも胃酸（塩酸）にも溶けないので、Ba²⁺ として体に吸収されないためです。

硫酸カルシウムは天然には二水和物 CaSO₄・2H₂O（**セッコウ**）として存在します。セッコウを約 140℃ に加熱すると水和水の一部を失って、半水和物の**焼きセッコウ** CaSO₄・½H₂O になります。焼きセッコウを水で練ると、体積をやや増しながらセッコウにもどって固まるので、建材やセッコウ像に使われます。

:::reaction
left: CaSO₄・2H₂O
over: 加熱
arrow: ⇄
right: CaSO₄・½H₂O ＋ ³⁄₂H₂O
level: ★☆☆
note: 水で練ると左へもどります。式は書けなくても構いません。「焼きセッコウは半水和物」だけ覚えておけば十分です。
:::

//⚠ スライド 無機の基本６ s22 の焼きセッコウは「CaSO₄・H₂O」、式は「CaSO₄・2H₂O ⇄ CaSO₄・H₂O ＋ H₂O」、注記は「硫酸バリウム CaSO₄ はセッコウとして…」になっています。教科書どおり半水和物 CaSO₄・½H₂O と「硫酸カルシウム」で書きました。

炭酸イオン CO₃²⁻ も、Ba²⁺・Ca²⁺ と白色沈殿（BaCO₃・CaCO₃）をつくります。こちらは**塩酸に溶けて CO₂ を出す**ので、塩酸に溶けない硫酸塩と見分けられます。

:::link
to: precipitate
text: 陰イオンごとに沈む相手の一覧は沈殿の生成と色のページへ
:::

:::link
to: cation-separation
text: 炭酸塩の沈殿を使って Ca²⁺・Ba²⁺ を分ける手順は系統分離のページへ
:::

:::link
app: muki/tree
text: 系統分離で、炭酸アンモニウムで Ca²⁺・Ba²⁺ を沈める段を試す
:::

:::section
anchor: range
title: 覚える範囲
lead: Ca と水、カルシウムの化合物の5本、Ba²⁺・Ca²⁺ と SO₄²⁻ の沈殿、炎色の3色です。
:::

## 必ず覚えるもの（★★★）

:::list
items:
- Ca ＋ 2H₂O → Ca(OH)₂ ＋ H₂
- カルシウムの化合物の5本（CaCO₃ の熱分解・CaO と水・石灰水と CO₂・Ca(HCO₃)₂ の生成・CaCO₃ と塩酸）
- Ba²⁺ ＋ SO₄²⁻ → BaSO₄、Ca²⁺ ＋ SO₄²⁻ → CaSO₄
- 生石灰・消石灰・石灰石・セッコウ・焼きセッコウの化学式
- 炎色反応 Ca 橙赤色・Sr 紅色・Ba 黄緑色
:::

Mg の反応（熱水・燃焼・塩酸）は、Ca の式と同じ形で書けるので、個別に覚えなくても構いません。Be・Ra の性質は覚えなくても困ることはほとんどありません。

## 例題

:::exercise
source: 自作（このページの ★★★ の式を物質名から書く）
prompt: 次の変化を化学反応式で書け。**(1) カルシウムを水に入れた　(2) 石灰石を強熱した　(3) 生石灰に水を加えた　(4) 石灰水に二酸化炭素を通じると白濁し、(5) さらに通じ続けると透明になった　(6) 塩化バリウム水溶液に希硫酸を加えた**
answer: (1) Ca ＋ 2H₂O → Ca(OH)₂ ＋ H₂　(2) CaCO₃ → CaO ＋ CO₂　(3) CaO ＋ H₂O → Ca(OH)₂　(4) Ca(OH)₂ ＋ CO₂ → CaCO₃ ＋ H₂O　(5) CaCO₃ ＋ CO₂ ＋ H₂O → Ca(HCO₃)₂　(6) BaCl₂ ＋ H₂SO₄ → BaSO₄ ＋ 2HCl（イオン反応式なら Ba²⁺ ＋ SO₄²⁻ → BaSO₄）
:::

:::exercise
source: 自作（表の「Mg だけ仲間はずれ」を使って2つの水溶液を見分ける）
prompt: 塩化マグネシウム水溶液と塩化カルシウム水溶液がある。どちらかを見分ける操作を2つ答えよ。
answer: ① **炎色反応**を見る：橙赤色なら CaCl₂、色がつかなければ MgCl₂ です。② **希硫酸（または硫酸ナトリウム水溶液）を加える**：白色沈殿 CaSO₄ が生じれば CaCl₂、変化がなければ MgCl₂ です（MgSO₄ は水に溶けるため）。
:::
