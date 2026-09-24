---
id: chlorine
unit: inorg.nonmetal
unitLabel: 非金属元素
group: 塩素
title: 塩素と塩化水素
summary: 塩素 Cl₂ と塩化水素 HCl のまとめ。Cl₂ の性質表・実験室的製法と洗気瓶・水との反応・さらし粉、HCl の性質表・製法・酸と還元剤と沈殿の3つの顔、次亜塩素酸イオンと塩素のオキソ酸を1枚にしました。
codes:
  - inorg.nonmetal.chlorine-prep
  - inorg.nonmetal.chlorine-washing
  - inorg.nonmetal.chlorine-water
  - inorg.nonmetal.hcl-prep
  - inorg.nonmetal.hcl-roles
  - inorg.nonmetal.chlorine-oxoacid
  - inorg.nonmetal.chlorine-props
  - inorg.nonmetal.bleaching-powder
source:
  - slides:無機の基本５「ハロゲン」s18-29（練習は s38-45）
singleSource: true
why: ハロゲンの中で塩素だけは、製法（洗気瓶の順）・水との自己酸化還元・さらし粉・HCl の沈殿・オキソ酸と、単独で問われる話題が多く、名前でも引かれる。ハロゲンを並べて比べるページ（halogen）に入れると比較の表が埋もれるので分けた。HCl の反応を【酸】【還元剤】【沈殿】の役割で並べたのは、同じ HCl の H⁺ と Cl⁻ がそれぞれ別の型の反応をすることが、並べると一目でわかるため。本文はユーザー自身の講義スライド 無機の基本５ から取った。
---

塩素 Cl₂ は黄緑色の有毒な気体で、強い**酸化剤**です。塩化水素 HCl はその水溶液が塩酸で、代表的な1価の強酸です。このページでは Cl₂ と HCl を順に見て、最後に次亜塩素酸イオンと塩素のオキソ酸をまとめます。ほかのハロゲンとの比較は「ハロゲン」のページにあります。

:::link
to: halogen
text: ハロゲンの単体・ハロゲン化水素・ハロゲン化銀を並べて比べる表はこちら
:::

:::section
anchor: chlorine-props
title: 塩素の性質 —— 黄緑色で空気より重い、2価の酸化剤
lead: Cl₂ は黄緑色・刺激臭の気体です。水に少し溶けて酸性を示し、空気より重いので下方置換で捕集します。
terms:
- 塩素
- 下方置換
codes:
- inorg.nonmetal.chlorine-props
:::

:::table
caption: 塩素 Cl₂ の性質
source: slides:無機の基本５「ハロゲン」s18「塩素の性質」の表（欄の並びもスライドのまま）
head:
- 項目
- 塩素 Cl₂
- 理由・補足
align: left | left | left
rows:
- 色・におい | 黄緑色・刺激臭 | −
- 分子量 | 71 | 空気（平均分子量 28.8）より重い
- 水への溶解 | 少し溶ける | 無極性分子だが、水と酸化還元反応を起こして少し溶ける
- 捕集法 | 下方置換 | 水に溶け、空気より重い
- 水溶液の液性 | 酸性 | 水に溶けて HCl と HClO を生じる
- 酸化剤／還元剤 | 酸化剤 | 2価の強い酸化剤
:::

:::section
anchor: chlorine-prep
title: 塩素の製法 —— 酸化マンガン(Ⅳ)に濃塩酸、洗気瓶は水 → 濃硫酸
lead: 実験室では MnO₂ に濃塩酸を加えて加熱します。出てきた気体は水 → 濃硫酸の順に洗気瓶に通して HCl と H₂O を除きます。
terms:
- 洗気瓶
- 高度さらし粉
codes:
- inorg.nonmetal.chlorine-prep
- inorg.nonmetal.chlorine-washing
:::

## 実験室的製法1 —— 酸化マンガン(Ⅳ)に濃塩酸を加えて加熱する

:::reaction
left: MnO₂ ＋ 4HCl
over: 加熱
right: MnCl₂ ＋ 2H₂O ＋ Cl₂↑
level: ★★★
note: MnO₂ が酸化剤、HCl の Cl⁻ が還元剤。MnO₂ ＋ 4H⁺ ＋ 2e⁻ → Mn²⁺ ＋ 2H₂O と 2Cl⁻ → Cl₂ ＋ 2e⁻ を足し、両辺に 2Cl⁻ を戻すと化学反応式になります。
:::

この反応は必ず覚えてください。条件の2つにも理由があります。本来は MnO₂ より Cl₂ の方が酸化力が強く、逆向きに進む反応を無理に進めているので、濃度の大きい**濃塩酸**を使います。また**加熱**して、発生した Cl₂ を追い出し、逆反応を防ぎます。

## 実験室的製法2 —— 高度さらし粉に希塩酸を加える

:::reaction
left: Ca(ClO)₂・2H₂O ＋ 4HCl
right: CaCl₂ ＋ 2Cl₂↑ ＋ 4H₂O
level: ★★☆
note: 高度さらし粉の ClO⁻ が酸化剤、希塩酸の Cl⁻ が還元剤。こちらは加熱が要りません。
:::

## 洗気瓶で不純物を除く

MnO₂ と濃塩酸で発生させた Cl₂ には、塩酸から蒸発した HCl と H₂O が混じっています。これを「**水 → 濃硫酸**」の順に洗気瓶に通して取り除き、下方置換で捕集します。

:::list
ordered: true
items:
- 1本目の水に通す。HCl は水によく溶けるので、ここで除かれる。
　Cl₂ は水に少ししか溶けないので通り抜ける。ただし水からまた H₂O が蒸発して混じる。
- 2本目の濃硫酸に通す。H₂O は濃硫酸に吸収されて除かれる。
- Cl₂ は空気より重いので下方置換で捕集する。
:::

**順番は「水 → 濃硫酸」で覚えましょう。**逆に「濃硫酸 → 水」の順にすると、最後の水から蒸発した H₂O が取り除けません。

:::figure
src: chlorine-gas-washing.png
alt: Cl₂・H₂O・HCl の混じった気体を、水の入った洗気瓶、濃硫酸の入った洗気瓶の順に通し、最後の容器に下方置換で集める装置の図。HCl は水に、H₂O は濃硫酸に残ることと、水からは H₂O が新たに蒸発することが書き込まれている
caption: 水で HCl を、濃硫酸で H₂O を除きます。水の瓶から新たに蒸発する H₂O まで取り除けるのは、この順だけです。
:::

工業的には、塩化ナトリウム水溶液の電気分解で Cl₂ をつくります。

:::link
to: electrolysis-industry
text: 塩化ナトリウム水溶液の電気分解（イオン交換膜法）はこちら
:::

:::link
to: gas-preparation
text: 気体の製法・捕集法・乾燥剤を横に並べた早見表はこちら
:::

:::section
anchor: chlorine-reactions
title: 塩素の反応 —— 酸化剤、ときに自己酸化還元
lead: Cl₂ は Cl₂ ＋ 2e⁻ → 2Cl⁻ の酸化剤としてはたらきます。水や水酸化カルシウムとは、Cl₂ が酸化剤と還元剤の両方になる自己酸化還元反応をします。
terms:
- 次亜塩素酸
- さらし粉
- 自己酸化還元反応
codes:
- inorg.nonmetal.chlorine-water
- inorg.nonmetal.bleaching-powder
:::

:::reaction
left: Cl₂ ＋ 2e⁻
right: 2Cl⁻
level: ★★★
note: 塩素が酸化剤としてはたらくときの半反応式。Cl は安定な Cl⁻ になります。
:::

:::figure
src: chlorine-app-cl2-half.png
shot: url=/ion-equation/halfreaction.html?q=Cl2_red sel=#timeline 状態=開いた直後（何も入れていない）
alt: Cl₂ と 2Cl⁻ だけが書かれた式に、H₂O・H⁺・e⁻ の数を入れて半反応式を完成させる画面。手順A「H₂O → H⁺ → e⁻」が選ばれている
caption: 反応の前後（Cl₂ → 2Cl⁻）だけを覚えておき、H₂O・H⁺・e⁻ を順に入れて半反応式にします。この式では O も H も無いので、e⁻ を2個入れるだけです。
:::

:::link
app: ion-equation/halfreaction
id: Cl2_red
text: 塩素が酸化剤としてはたらく半反応式を組む
:::

## 金属を酸化する

:::reaction
left: Cu ＋ Cl₂
right: CuCl₂
level: ★★☆
note: Cl₂ は多くの金属と反応して酸化します。Cu → Cu²⁺ ＋ 2e⁻ と Cl₂ ＋ 2e⁻ → 2Cl⁻ を足したものです。
:::

## 水と反応する —— 塩素水

:::reaction
left: Cl₂ ＋ H₂O
arrow: ⇄
right: HCl ＋ HClO
level: ★★★
note: 塩素が水に溶けるときの反応。生じた次亜塩素酸 HClO が殺菌・漂白のはたらきをします。
:::

この反応では、Cl₂ の2つの Cl 原子のうち1つが −1（Cl⁻）、もう1つが +1（HClO の Cl）になります。Cl₂ が酸化剤と還元剤の両方としてはたらく**自己酸化還元反応**です。Cl₂ を Cl⁻ と Cl⁺ に分け、H₂O を H⁺ と OH⁻ に分けて組み合わせると、右辺の HCl と HClO がすぐに書けます。

## ヨウ化カリウムデンプン紙を青変させる —— 塩素の検出

:::reaction
left: Cl₂ ＋ 2KI
right: 2KCl ＋ I₂
level: ★★★
note: 湿らせたヨウ化カリウムデンプン紙が青変する（Cl₂・O₃ の検出）。ハロゲンの酸化力の比較と同じ反応です。
:::

KI 水溶液（無色）に Cl₂ を通じると、生じた I₂ が I⁻ と I₃⁻ になって溶液が褐色になることでも、Cl₂ を検出できます。

## 水酸化カルシウムに吸収させる —— さらし粉

:::reaction
left: Ca(OH)₂ ＋ Cl₂
right: CaCl(ClO)・H₂O
level: ★★☆
note: 水酸化カルシウムに塩素を吸収させると**さらし粉**ができます。これも Cl₂ が Cl⁻ と ClO⁻ に分かれる自己酸化還元反応です。
:::

さらし粉 CaCl(ClO)・H₂O は CaCl₂ と Ca(ClO)₂ の複塩で、そこから CaCl₂ を除いたものが**高度さらし粉** Ca(ClO)₂・2H₂O です。

## 水素と反応する —— 塩素爆鳴気

:::reaction
left: H₂ ＋ Cl₂
over: 光
right: 2HCl
level: ★★☆
note: 水素と塩素の混合気体（塩素爆鳴気）に光を当てると爆発的に反応します。HCl の合成反応でもあります。
:::

:::link
to: hydrogen-noble-gas
text: 水素が還元剤としてはたらく反応の一覧はこちら
:::

## 例題 —— 塩素の反応

紙に書いて解いてみてください。答え合わせは「解答を見る」から。

:::exercise
source: slides:無機の基本５「ハロゲン」s38「練習３」（解答は s39）
prompt: 次の化学反応式を書け。**(1) 酸化マンガン(Ⅳ)に濃塩酸を加え加熱した　(2) 高度さらし粉に希塩酸を加えた　(3) 塩素が酸化剤としてはたらいた（e⁻ とイオンを含む反応式で）　(4) 塩素が銅を酸化した**
answer: (1) MnO₂ ＋ 4HCl → MnCl₂ ＋ 2H₂O ＋ Cl₂↑　(2) Ca(ClO)₂・2H₂O ＋ 4HCl → CaCl₂ ＋ 2Cl₂↑ ＋ 4H₂O　(3) Cl₂ ＋ 2e⁻ → 2Cl⁻　(4) Cu ＋ Cl₂ → CuCl₂　(1)(3) は★★★、(2)(4) は★★☆です。
:::

:::exercise
source: slides:無機の基本５「ハロゲン」s40「練習４」（解答は s41）
prompt: 次の化学反応式を書け。**(1) 塩素が水に溶解した　(2) 塩素が湿らせたヨウ化カリウムデンプン紙を青変させた　(3) 水酸化カルシウムに塩素を吸収させた　(4) 水素と塩素の混合気体に光を当てた**
answer: (1) Cl₂ ＋ H₂O ⇄ HCl ＋ HClO　(2) Cl₂ ＋ 2KI → 2KCl ＋ I₂　(3) Ca(OH)₂ ＋ Cl₂ → CaCl(ClO)・H₂O　(4) H₂ ＋ Cl₂ → 2HCl　(1)(2) は★★★、(3)(4) は★★☆です。
:::

:::section
anchor: hcl
title: 塩化水素 —— H⁺ は酸、Cl⁻ は還元剤と沈殿
lead: HCl は無色・刺激臭で水によく溶ける気体です。塩化ナトリウムに濃硫酸を加えて加熱するとでき、NH₃ と白煙をつくることで検出します。
terms:
- 塩化水素
- 塩酸
- 白煙
codes:
- inorg.nonmetal.hcl-prep
- inorg.nonmetal.hcl-roles
:::

:::table
caption: 塩化水素 HCl の性質
source: slides:無機の基本５「ハロゲン」s24「塩化水素の性質」の表（欄の並びもスライドのまま）
head:
- 項目
- 塩化水素 HCl
- 理由・補足
align: left | left | left
rows:
- 色・におい | 無色・刺激臭 | −
- 分子量 | 36.5 | 空気（平均分子量 28.8）より重い
- 水への溶解 | よく溶ける | 極性分子で、しかも酸
- 捕集法 | 下方置換 | 水によく溶け、空気より重い
- 水溶液の液性 | 強酸性 | 水溶液が塩酸（HCl と水の混合物）
- 酸化剤／還元剤 | − | イオン化傾向が H₂ より大きい金属に対しては H⁺ が酸化剤
:::

## 塩化水素の製法 —— 揮発性の酸の遊離

:::reaction
left: NaCl ＋ H₂SO₄
over: 加熱
right: NaHSO₄ ＋ HCl↑
level: ★★★
note: 揮発性の酸 HCl が、不揮発性の酸 H₂SO₄ によって追い出される反応です。「濃硫酸が登場する反応は加熱が必要」と覚えます。
:::

:::mistake
wrong: 2NaCl ＋ H₂SO₄ → Na₂SO₄ ＋ 2HCl
right: NaCl ＋ H₂SO₄ → **NaHSO₄** ＋ HCl。右辺は Na₂SO₄ ではなく、硫酸水素ナトリウム NaHSO₄ です。
why: H₂SO₄ が2価の酸なので、H⁺ を2個とも渡すと考えてしまうためです。2段階目の電離は起こりにくく（500℃以上の高温にすれば起こる）、この条件では1段階目まで。2段階目が起こりにくいのは、−1 の HSO₄⁻ から、さらに正の H⁺ を引き離すことになり、クーロン力に逆らうためです。
:::

:::link
to: acid-displacement
text: 弱酸の遊離・揮発性の酸の遊離の考え方はこちら
:::

## 塩化水素の反応 —— 役割ごとに

塩酸は代表的な1価の強酸です。同じ HCl でも、**H⁺ と Cl⁻ がそれぞれ別の型の反応**をします。

【酸（H⁺ が酸化剤）】H⁺ はイオン化傾向が H₂ より大きい金属を溶かします。

:::reaction
left: Zn ＋ 2HCl
right: ZnCl₂ ＋ H₂↑
level: ★★★
note: HCl の H⁺ が酸化剤、Zn が還元剤。
:::

【還元剤（Cl⁻）】Cl⁻ は弱い還元剤としてはたらくことがあります。上の MnO₂ ＋ 4HCl → MnCl₂ ＋ 2H₂O ＋ Cl₂ がその例です。

:::callout
tone: caution
text: 酸化還元反応を酸性条件で起こすとき、塩酸は使いません。Cl⁻ が還元剤として余計な反応を起こすためです（硝酸も NO₃⁻ が酸化剤になるので使わない）。酸性にするには硫酸を加え、**硫酸酸性**にします。
:::

【塩基との中和】HCl にアンモニア水をつけたガラス棒を近づけると、塩化アンモニウム NH₄Cl の白煙が生じます。これが **HCl の検出**です（逆に NH₃ に塩酸をつけたガラス棒を近づけるのが NH₃ の検出）。

:::reaction
left: HCl ＋ NH₃
right: NH₄Cl
level: ★★★
note: 酸と塩基の中和反応。NH₄Cl はイオン結晶の固体で、空気中に細かく散って煙に見えます。
:::

【沈殿（Cl⁻）】Cl⁻ は Ag⁺・Pb²⁺ と白色の沈殿をつくります（Ag⁺・Pb²⁺ の検出）。**電荷が合うようにイオンを組み合わせる**だけで書けます。

:::reaction
left: Ag⁺ ＋ Cl⁻
right: AgCl↓
level: ★★★
note: 白色沈殿。AgCl は過剰のアンモニア水に [Ag(NH₃)₂]⁺ をつくって溶けます。
:::

:::reaction
left: Pb²⁺ ＋ 2Cl⁻
right: PbCl₂↓
level: ★★★
note: 白色沈殿。PbCl₂ は熱水に溶けるので、AgCl と区別できます。
:::

**Cl⁻ で沈殿する金属イオンは Ag⁺ と Pb²⁺ の2つだけ覚えれば十分です。**ほかに Hg₂²⁺ も Hg₂Cl₂ の沈殿をつくりますが、ほとんど登場しません。

:::link
to: precipitate
text: 陰イオンごとに沈む相手と沈殿の色の一覧はこちら
:::

:::link
app: ion-equation/index
id: s4
text: 硝酸銀と塩化ナトリウムの沈殿反応の係数を決める
:::

## 例題 —— 塩化水素

:::exercise
source: slides:無機の基本５「ハロゲン」s42「練習５」（解答は s43）
prompt: 次の化学反応式を書け。**(1) 塩化ナトリウムに濃硫酸を加え加熱した　(2) 塩酸にアルミニウム片を入れた　(3) 塩化ナトリウム水溶液に硝酸銀水溶液を滴下した　(4) 鉛(Ⅱ)イオンを含む水溶液に塩化物イオンを含む水溶液を滴下した（イオンを含む反応式で）　(5) 塩化水素にアンモニア水をつけたガラス棒を近づけたら白煙が生じた**
answer: (1) NaCl ＋ H₂SO₄ → NaHSO₄ ＋ HCl↑　(2) 2Al ＋ 6HCl → 2AlCl₃ ＋ 3H₂↑　(3) AgNO₃ ＋ NaCl → NaNO₃ ＋ AgCl↓　(4) Pb²⁺ ＋ 2Cl⁻ → PbCl₂↓　(5) HCl ＋ NH₃ → NH₄Cl　すべて★★★です。(2) は Al → Al³⁺ ＋ 3e⁻ と 2H⁺ ＋ 2e⁻ → H₂ の e⁻ を6にそろえて足します。(3) は Ag⁺ ＋ Cl⁻ → AgCl に、反応しない NO₃⁻ と Na⁺ を両辺に戻したものです。
:::

:::section
anchor: oxoacid-cl
title: 次亜塩素酸と塩素のオキソ酸
lead: 次亜塩素酸イオン ClO⁻ は強い2価の酸化剤で、漂白・殺菌に使われます。塩素のオキソ酸は Cl の酸化数が大きいほど強い酸ですが、酸化力は逆の順です。
terms:
- 次亜塩素酸イオン
- 塩素のオキソ酸
- 塩素酸カリウム
codes:
- inorg.nonmetal.chlorine-oxoacid
:::

次亜塩素酸 HClO・高度さらし粉 Ca(ClO)₂・2H₂O・さらし粉 CaCl(ClO)・H₂O など、**ClO⁻ を含む化合物は強い酸化剤**です。ClO⁻ の Cl（+1）が安定な Cl⁻（−1）になるので、2価です。

:::reaction
left: ClO⁻ ＋ 2H⁺ ＋ 2e⁻
right: Cl⁻ ＋ H₂O
level: ★★☆
note: 次亜塩素酸 HClO で書くなら HClO ＋ H⁺ ＋ 2e⁻ → Cl⁻ ＋ H₂O。
:::

さらし粉・高度さらし粉はプールの消毒剤や漂白剤に、次亜塩素酸ナトリウム NaClO は家庭用の漂白剤に使われます。漂白剤は一般に酸化剤か還元剤で、色素の分子を酸化または還元して壊すことで色を消します。

:::table
caption: 塩素のオキソ酸
source: slides:無機の基本５「ハロゲン」s29「塩素の化合物とその反応④」の表（第1部の版。⚠ 第3部の再掲ではこの1枚が抜けている）。名前と Cl の酸化数は s9「過・亜・次亜」の規則から足した
head:
- 名前
- 化学式
- Cl の酸化数
- 酸の強さ
- 酸化力
align: left | left | right | left | left
rows:
- 次亜塩素酸 | HClO | +1 | 弱い | 強い
- 亜塩素酸 | HClO₂ | +3 | ↓ | ↓
- 塩素酸 | HClO₃ | +5 | ↓ | ↓
- 過塩素酸 | HClO₄ | +7 | 強い | 弱い
:::

Cl の酸化数が大きいオキソ酸ほど電離しやすく、強い酸になります。ハロゲン化水素の酸の強さと同じく、大きい陰イオンの方が −1 の電荷を広く受け止められるためです。酸化力の強さは酸の強さの逆になりますが、その理由はかなり複雑なので覚える必要はありません。

:::link
to: oxoacid
text: 「過・亜・次亜」の名前の付け方と、オキソ酸の構造はこちら
:::

塩素酸カリウム KClO₃ に MnO₂ を触媒として加えて加熱すると、分解して O₂ が発生します（酸素の実験室的製法の1つ）。

:::reaction
left: 2KClO₃
over: MnO₂（触媒）・加熱
right: 2KCl ＋ 3O₂↑
level: ★★☆
note: KClO₃ の Cl（+5）が安定な Cl⁻ になり、O（−2）が O₂ になる自己酸化還元反応です。
:::

:::link
to: oxygen-ozone
text: 酸素の実験室的製法の3通りはこちら
:::

## 例題 —— 次亜塩素酸と塩素のオキソ酸

:::exercise
source: slides:無機の基本５「ハロゲン」s44「練習６」（解答は s45）
prompt: 次の反応式を書け。**(1) 次亜塩素酸が酸化剤としてはたらいた（e⁻ とイオンを含む反応式で）　(2) 塩素酸カリウムと酸化マンガン(Ⅳ)の混合物を加熱した**
answer: (1) HClO ＋ H⁺ ＋ 2e⁻ → Cl⁻ ＋ H₂O（ClO⁻ ＋ 2H⁺ ＋ 2e⁻ → Cl⁻ ＋ H₂O でもよい）　(2) 2KClO₃ → 2KCl ＋ 3O₂↑　どちらも★★☆です。
:::
