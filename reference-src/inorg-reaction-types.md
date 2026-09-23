---
id: inorg-reaction-types
unit: inorg.basis
unitLabel: 無機の土台
group: 無機の反応の型
title: 無機の反応は5つの型で読む
summary: 無機の反応式は、中和・遊離・酸化還元・沈殿・錯イオンの5つの型のどれかに当てはまります。型を見分けて、型ごとの書き方のページへ進むための入口です。
codes:
  - inorg.basis.five-types
  - inorg.basis.redox-first
  - inorg.basis.displacement
  - inorg.basis.complex-dissolve
  - inorg.basis.outside-five
source:
  - slides:無機の基本１「無機の前に復習すべきこと」s12-28（中和・遊離の型）・s30-45（酸化還元の型）・練習５ s56-58
  - slides:無機の基本５「ハロゲン」s27（沈殿 Ag⁺ ＋ Cl⁻）
  - slides:無機の基本６「硫黄」s9・s22（遊離・沈殿の例）
  - ion:STAGE_SERIES（沈殿と錯イオンを1つの系列に束ねる割り方）
  - textbook:R5化学Vol.2-4編（錯イオンの例の式・弱塩基の遊離の式）
singleSource: false
why: 無機の反応式は物質ごとのページに散っていて、並べないと「同じ書き方で書ける仲間」が見えない。スライドの無機の基本１が酸塩基と酸化還元を「無機の前に復習すべきこと」として先に置き、無機の基本３〜６ の反応をすべてその型に帰着させているので、その型に沈殿・錯イオンを足した5つで一覧にした。沈殿と錯イオンを分けて数えたのは、錯イオンだけが「沈殿が過剰の試薬で溶ける」という別の手がかりで見分けるため（ion の STAGE_SERIES は2つを1系列にまとめているが、書き方の手順は別）。反応式そのものは各物質のページが持ち、ここは1型につき代表の式1〜3本とリンクにとどめた。
---

無機化学で覚える反応式は数が多いですが、ほとんどは**中和・遊離・酸化還元・沈殿・錯イオン**の5つの型のどれかに当てはまります。型が分かれば、反応式は「その型の書き方」で組み立てられます。

中和と遊離は酸と塩基、酸化還元は酸化剤と還元剤の知識が前提です。まだの場合は先にそれぞれのページを読んでください。

:::link
to: acid-base-definition
text: 酸と塩基の定義のページへ
:::

:::link
to: redox-basics
text: 酸化と還元のページへ
:::

:::section
anchor: five-types
title: 5つの型の一覧
lead: 何と何が結びつくか（やりとりするか）で型が決まります。
terms:
- 中和
- 弱酸の遊離
- 酸化還元
- 沈殿
- 錯イオン
:::

:::table
caption: 無機の反応の5つの型
source: 型の分け方と中和・遊離・酸化還元の例は slides:無機の基本１ s13・s24・s44、沈殿の例は slides:無機の基本５ s27、錯イオンの例は textbook:R5化学Vol.2-4編。見分ける手がかりの列はこのページで書いた要約
head:
- 型
- 何が起きるか
- 見分ける手がかり
- 代表の式
align: center | left | left | left
rows:
- **中和** | H⁺ と OH⁻ が結びついて H₂O ができる | 酸（酸性酸化物）と塩基（塩基性酸化物）の組み合わせ | HCl ＋ NaOH → NaCl ＋ H₂O
- **遊離** | 弱酸（弱塩基）の陰イオン（陽イオン）が H⁺（OH⁻）と結びつく | 弱酸の塩に強酸、弱塩基の塩に強塩基、揮発性の酸の塩に不揮発性の酸を加える | FeS ＋ H₂SO₄ → FeSO₄ ＋ H₂S↑
- **酸化還元** | 還元剤が出した e⁻ を酸化剤が受け取る | 酸化数が変わる原子がある（単体が出入りする反応は必ずこれ） | Zn ＋ H₂SO₄ → ZnSO₄ ＋ H₂↑
- **沈殿** | 水に溶けない組み合わせの陽イオンと陰イオンが固体になる | 生成物に ↓（Ag⁺ と Cl⁻、Ba²⁺ と SO₄²⁻ など） | AgNO₃ ＋ NaCl → AgCl↓ ＋ NaNO₃
- **錯イオン** | 金属イオンに NH₃ や OH⁻ が配位結合する | 沈殿が過剰のアンモニア水・水酸化ナトリウム水溶液で溶ける | AgCl ＋ 2NH₃ → [Ag(NH₃)₂]⁺ ＋ Cl⁻
:::

**5つの型の名前と、それぞれの「見分ける手がかり」は覚えてください。**反応式そのものは各物質のページで覚えます。そのときに「反応前後の物質の化学式は暗記、係数は型の手順で出す」と分けると、覚える量が減ります。

:::link
app: ion-equation/portal
id: sr-acid-base
text: 酸と塩基の反応（中和・弱酸の遊離）
:::

:::link
app: ion-equation/portal
id: sr-redox
text: 酸化還元の反応（e⁻ のやりとり）
:::

:::link
app: ion-equation/portal
id: sr-precipitate
text: 沈殿と溶解の反応（沈殿・錯イオン）
:::

:::section
anchor: how-to-tell
title: 型の見分け方
lead: 酸化数が変わるかどうかを最初に見ます。変わらなければ、H⁺ と OH⁻ のやりとりか、沈殿か、錯イオンかを見ます。
:::

:::list
ordered: true
items:
- 反応の前後で、酸化数が変わる原子があるかを見る。あれば**酸化還元**。
　左辺か右辺に単体（Zn・Cu・Cl₂・O₂ など）があれば、その原子の酸化数は必ず変わります。
- 酸化数が変わらず、H⁺ と OH⁻ が結びついて H₂O ができるなら**中和**。
　酸性酸化物（CO₂・SO₃）や塩基性酸化物（CaO・Na₂O）が相手でも中和の仲間です。
- 弱酸・弱塩基・揮発性の酸が「生成物として出てくる」なら**遊離**。
　H₂S・SO₂・CO₂・NH₃・HCl の気体が発生する反応の多くはこれです。
- 生成物に水に溶けない塩ができるなら**沈殿**。
- いったんできた沈殿が、過剰の NH₃ や OH⁻ で溶けるなら**錯イオン**。
:::

## 具体例：同じ SO₂ でも型が違う

二酸化硫黄 SO₂ を発生させる方法は2つあり、型が違います。

:::reaction
left: Na₂SO₃ ＋ H₂SO₄
right: Na₂SO₄ ＋ H₂O ＋ SO₂↑
level: ★★★
note: S の酸化数は +4 のまま変わりません。弱酸の H₂SO₃ が強酸の H₂SO₄ に追い出され、H₂O と SO₂ に分かれます（**遊離**）。
:::

:::reaction
left: Cu ＋ 2H₂SO₄
over: 加熱（熱濃硫酸）
right: CuSO₄ ＋ 2H₂O ＋ SO₂↑
level: ★★★
note: 単体の Cu が Cu²⁺ に、S が +6 から +4 に変わります（**酸化還元**）。
:::

できる気体は同じでも、書き方の手順が違います。遊離は「イオンの組み換え」で1行で書け、酸化還元は「半反応式を書いてから足す」手順で書きます。**型を先に決める理由はここにあります。**

:::section
anchor: neutralization
title: 中和の型
lead: 酸の H⁺ と塩基の OH⁻ が結びついて水になり、残りのイオンが塩になります。
terms:
- 中和反応
- 塩
:::

:::figure
src: inorg-reaction-types-neutralization.png
alt: 酸（H⁺ と陰イオン）と塩基（陽イオンと OH⁻）が反応して、陽イオンと陰イオンが塩に、H⁺ と OH⁻ が水になる組み換えの図
caption: 中和は**イオンの組み換え**です。酸の H⁺ と塩基の OH⁻ が水に、残りの陽イオンと陰イオンが塩になります。
:::

:::reaction
left: HCl ＋ NaOH
right: NaCl ＋ H₂O
level: ★★★
note: 酸と塩基は価数の逆の比で反応します。
:::

酸性酸化物・塩基性酸化物の反応も、同じ中和の型で書けます。たとえば CO₂ ＋ 2NaOH → Na₂CO₃ ＋ H₂O は、炭酸 H₂CO₃ と NaOH の中和から H₂O を1つ引いた式です。

:::link
to: neutralization
text: 中和の反応式の書き方（価数の逆の比）のページへ
:::

:::link
to: oxoacid
text: 酸化物が水・酸・塩基と反応する式のページへ
:::

:::section
anchor: displacement
title: 遊離の型
lead: 弱い酸（塩基）の陰イオン（陽イオン）が、強い酸（塩基）から H⁺（OH⁻）を受け取ります。
terms:
- 弱酸の遊離
- 弱塩基の遊離
- 揮発性の酸の遊離
:::

弱酸の塩に強酸を加えると、弱酸が生じて強酸の塩が残ります。これを**弱酸の遊離**といいます。弱酸の陰イオンが H⁺ と結びつきたがるためです。

:::reaction
left: FeS ＋ H₂SO₄
right: FeSO₄ ＋ H₂S↑
level: ★★★
note: 弱酸の H₂S が強酸の H₂SO₄ に追い出されます。H₂S の実験室的製法です。
:::

弱塩基の塩に強塩基を加えると、弱塩基が生じます（**弱塩基の遊離**）。

:::reaction
left: 2NH₄Cl ＋ Ca(OH)₂
over: 加熱
right: CaCl₂ ＋ 2H₂O ＋ 2NH₃↑
level: ★★★
note: 弱塩基の NH₃ が強塩基の Ca(OH)₂ に追い出されます。NH₃ の実験室的製法です。
:::

揮発性の酸の塩に、不揮発性の酸（濃硫酸）を加えて加熱すると、揮発性の酸が気体になって出ていきます（**揮発性の酸の遊離**）。

:::reaction
left: NaCl ＋ H₂SO₄
over: 加熱（濃硫酸）
right: NaHSO₄ ＋ HCl↑
level: ★★★
note: HCl は強酸ですが揮発性なので、不揮発性の H₂SO₄ に追い出されます。
:::

:::link
to: acid-displacement
text: 弱酸の遊離・揮発性の酸の遊離のページへ
:::

:::section
anchor: redox
title: 酸化還元の型
lead: 還元剤が出した e⁻ を酸化剤が受け取ります。半反応式を2本書いて、e⁻ をそろえて足します。
terms:
- 酸化剤
- 還元剤
- 半反応式
:::

:::figure
src: inorg-reaction-types-redox.png
alt: 亜鉛板を硫酸銅(II)水溶液に入れると銅が析出し、希酸に入れると水素が発生する様子と、それぞれの半反応式を足し合わせた式
caption: 金属樹の生成と、金属が希酸に溶ける反応は同じ仕組みです。どちらも Zn が出した e⁻ を、Cu²⁺ か H⁺ が受け取ります。
:::

:::reaction
left: Zn ＋ H₂SO₄
right: ZnSO₄ ＋ H₂↑
level: ★★★
note: Zn が還元剤、希硫酸の H⁺ が酸化剤です。H₂ の実験室的製法です。
:::

無機の酸化還元では、**反応前後の物質（MnO₄⁻ → Mn²⁺ など）だけを暗記し、半反応式と全体の式は手順で組み立てます。**

:::link
to: half-reaction
text: 半反応式の書き方と、覚える酸化剤・還元剤のページへ
:::

:::link
to: redox-equation
text: 半反応式から反応式を組み立てるページへ
:::

:::section
anchor: precipitate
title: 沈殿の型
lead: 水に溶けない組み合わせの陽イオンと陰イオンが出会うと、固体になって沈みます。
terms:
- 沈殿
- イオン反応式
:::

:::figure
src: inorg-reaction-types-app-agcl.png
shot: url=/ion-equation/?rxn=s4 sel=#recombineWrap 状態=左辺 1,1・右辺 1,1 を入れて「係数どおりに再生」→「組み替える」を押したあと
alt: AgNO₃ と NaCl のイオンを組み替えて、AgCl と NaNO₃ ができる様子を示したアプリの画面
caption: 沈殿もイオンの組み換えです。Ag⁺ と Cl⁻ が組んだ AgCl は水に溶けないので沈みます。
:::

:::reaction
left: Ag⁺ ＋ Cl⁻
right: AgCl↓
level: ★★★
note: 白色沈殿。塩化物イオンの検出に使います。
:::

:::reaction
left: Ba²⁺ ＋ SO₄²⁻
right: BaSO₄↓
level: ★★★
note: 白色沈殿。硫酸イオンの検出に使います。
:::

沈殿の反応は、沈殿にかかわらないイオン（上の例なら Na⁺ と NO₃⁻）を省いた**イオン反応式**で書くのがふつうです。

:::link
to: precipitate
text: どのイオンの組み合わせが沈殿するか（沈殿の色）のページへ
:::

:::section
anchor: complex
title: 錯イオンの型
lead: 金属イオンに NH₃ や OH⁻ が配位結合すると、沈殿が溶けて錯イオンになります。
terms:
- 錯イオン
- 配位結合
- 両性水酸化物
:::

錯イオンの反応は、**沈殿がいったんでき、試薬を過剰に加えると溶ける**という2段で出てきます。溶けるときに錯イオンができています。

:::reaction
left: AgCl ＋ 2NH₃
right: [Ag(NH₃)₂]⁺ ＋ Cl⁻
level: ★★★
note: 塩化銀の白色沈殿が、アンモニア水に溶けます。
:::

:::reaction
left: Cu(OH)₂ ＋ 4NH₃
right: [Cu(NH₃)₄]²⁺ ＋ 2OH⁻
level: ★★★
note: 青白色の沈殿が、過剰のアンモニア水で深青色の溶液になります。
:::

:::reaction
left: Al(OH)₃ ＋ NaOH
right: Na[Al(OH)₄]
level: ★★★
note: 両性水酸化物は、過剰の水酸化ナトリウム水溶液に溶けます。
:::

:::link
to: complex-ion
text: 錯イオンの形と名前のページへ
:::

:::link
to: amphoteric-metal
text: 両性金属（Al・Zn・Sn・Pb）のページへ
:::

:::section
anchor: others
title: 5つの型に入らない反応
lead: 燃焼や化合のように、イオンにならずに分子どうしが組み替わる反応もあります。
:::

水素の燃焼 2H₂ ＋ O₂ → 2H₂O やアンモニアの合成 N₂ ＋ 3H₂ → 2NH₃ は、分子がばらばらの原子になって組み替わる反応として書けます。どちらも酸化数が変わるので、型としては酸化還元に入ります。係数は原子の数を両辺でそろえれば決まります。

熱分解（CaCO₃ → CaO ＋ CO₂ など）も、酸化数が変わらない反応です。これは各物質のページで扱います。

:::link
app: ion-equation/portal
id: sr-molecule
text: 分子の組み換え
:::

:::section
anchor: range
title: 覚える範囲
lead: 5つの型の名前と、見分ける手がかりを覚えます。
:::

**5つの型（中和・遊離・酸化還元・沈殿・錯イオン）と、それぞれの見分ける手がかりは必ず覚えてください。**

反応式は、このページに出した ★★★ の式を物質名から書けるようにしておきます。ほかの反応式は各物質のページで、型ごとの手順を使って書く練習をします。

5つの型に入らない反応（熱分解など）は数が少ないので、出てきたときに1本ずつ覚えれば十分です。

## 例題

:::exercise
source: slides:無機の基本１「無機の前に復習すべきこと」s56「練習５」(1)〜(4)（解答は s57・s58）
prompt: 次の(1)〜(4)を化学反応式で書け。また、それぞれ5つの型のどれに当たるか答えよ。**(1) 酢酸ナトリウム水溶液に塩酸を加えた　(2) 塩化アンモニウム水溶液に水酸化ナトリウム水溶液を加えた　(3) 硫化鉄(II)に希硫酸を加えた　(4) 塩化アンモニウムと水酸化カルシウムを混合して加熱した**
answer: (1) CH₃COONa ＋ HCl → CH₃COOH ＋ NaCl（弱酸の遊離）　(2) NH₄Cl ＋ NaOH → NaCl ＋ H₂O ＋ NH₃（弱塩基の遊離）　(3) FeS ＋ H₂SO₄ → FeSO₄ ＋ H₂S↑（弱酸の遊離）　(4) 2NH₄Cl ＋ Ca(OH)₂ → CaCl₂ ＋ 2H₂O ＋ 2NH₃↑（弱塩基の遊離）　4つとも、弱い酸・塩基のイオンが H⁺ か OH⁻ と結びつく同じ型です。
:::

:::exercise
source: 自作（このページの ★★★ の式を型で分ける問い）
prompt: 次の反応は、中和・遊離・酸化還元・沈殿・錯イオンのどの型か答えよ。**(1) Zn ＋ H₂SO₄ → ZnSO₄ ＋ H₂　(2) Ba²⁺ ＋ SO₄²⁻ → BaSO₄　(3) NaCl ＋ H₂SO₄ → NaHSO₄ ＋ HCl　(4) AgCl ＋ 2NH₃ → [Ag(NH₃)₂]⁺ ＋ Cl⁻　(5) CO₂ ＋ 2NaOH → Na₂CO₃ ＋ H₂O**
answer: (1) 酸化還元（Zn の酸化数が 0 → +2）　(2) 沈殿　(3) 遊離（揮発性の酸の遊離）　(4) 錯イオン　(5) 中和（酸性酸化物と塩基）
:::
