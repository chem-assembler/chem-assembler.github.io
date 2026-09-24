---
id: oxoacid
unit: inorg.basis
unitLabel: 無機の土台
group: 酸化物とオキソ酸
title: 酸化物とオキソ酸
summary: 酸化物は酸性・塩基性・両性の3つに分かれます。水・酸・塩基との反応式を、オキソ酸・水酸化物の中和から導きます。過・亜・次亜の名前と、オキソ酸の構造（配位結合）もここで扱います。
codes:
  - inorg.basis.oxide-class
  - inorg.basis.max-oxidation
  - inorg.basis.oxide-water
  - inorg.basis.oxide-neutralization
  - inorg.basis.oxoacid-naming
  - inorg.basis.period3-acidity
  - inorg.basis.oxoacid-def
  - inorg.basis.oxide-ion-equation
  - inorg.basis.amphoteric-oxide
  - inorg.basis.oxoacid-structure
source:
  - slides:無機の基本４「酸素と酸化物」s14-16（酸化物の分類・オキソ酸の命名・周期表との関係）・s23-36（最高酸化数・酸化物と水／酸／塩基の反応）・練習１・８〜１２（s38-39・s53-62）
  - slides:無機の基本１「無機の前に復習すべきこと」s9-10（配位結合）
  - textbook:R5化学Vol.2-4編（H₂O・NO・CO を酸性酸化物に入れないこと、両性酸化物と酸・強塩基の反応式、第3周期の表）
singleSource: false
why: 酸化物の反応式は数が多いが、スライドの無機の基本４ は「対応するオキソ酸・水酸化物の中和の式から H₂O を引く」という1本の手順で全部を書かせている。その手順を主役にし、式は族の順（S・P・Cl・C・Si／Na・Ca）に並べた。オキソ酸の名前と構造もこのページに置いたのは、有機の官能基のページ（ニトロ基・スルホ基）から「硝酸・硫酸そのものの構造」として指されているため。両性酸化物の式はスライドに無いので教科書で事実を確かめ、両性金属のページへ渡す一言にとどめた。
---

酸素はほとんどの元素と化合して酸化物をつくります。酸化物は、水や酸・塩基との反応のしかたで3つに分けられます。このページでは、その分け方と、反応式を**中和の式から導く手順**を見ていきます。

酸と塩基の中和と、酸化数の決め方を前提にします。

:::link
to: neutralization
text: 中和反応（価数の逆の比）のページへ
:::

:::link
to: oxidation-number
text: 酸化数の決め方のページへ
:::

:::section
anchor: classification
title: 酸化物の3つの分類
lead: 非金属元素の酸化物は酸性酸化物、金属元素の酸化物は塩基性酸化物、両性元素（Al・Zn・Sn・Pb）の酸化物は両性酸化物です。
terms:
- 酸性酸化物
- 塩基性酸化物
- 両性酸化物
- 両性元素
codes:
- inorg.basis.oxide-class
:::

:::figure
src: oxoacid-classification.png
alt: 周期表の左下を陽性、右上を陰性とし、金属と非金属の境目付近にある Al・Zn・Sn・Pb を両性として丸で囲んだ図
caption: 両性元素 Al・Zn・Sn・Pb は、周期表の金属元素と非金属元素の境目の近くにあります。
:::

:::table
caption: 酸化物の3つの分類
source: slides:無機の基本４「酸素と酸化物」s14 の3項目を、水との反応・酸塩基との反応の列に並べ直したもの。例の列は s16・練習１の解答（s39）から
head:
- 分類
- どの元素の酸化物か
- 水と反応すると
- 反応する相手
- 例
align: center | left | left | left | left
rows:
- **酸性酸化物** | 非金属元素 | オキソ酸になる | 塩基 | CO₂・SO₂・SO₃・NO₂・P₄O₁₀・SiO₂・Cl₂O₇
- **塩基性酸化物** | 金属元素 | 水酸化物（塩基）になる | 酸 | Na₂O・K₂O・CaO・BaO・MgO・CuO・Ag₂O
- **両性酸化物** | 両性元素（Al・Zn・Sn・Pb） | 反応しない | 酸と強塩基の両方 | Al₂O₃・ZnO・SnO₂・PbO₂
:::

**両性元素の4つ（Al・Zn・Sn・Pb）は「ああすんなり（あ・あ・すん・なり）」で覚えましょう。**

:::mistake
wrong: 非金属元素の酸化物なので、CO や NO も酸性酸化物である
right: CO と NO は水に溶けにくく、塩基とも反応しないので、酸性酸化物には入れません。H₂O も酸性酸化物には入れません。
why: 「非金属元素の酸化物 ＝ 酸性酸化物」は、水と反応して酸になり、塩基と反応して塩になるものを指す、という性質で決めた呼び名です。性質をもたないものは、非金属元素の酸化物でも入りません。
:::

## 例題 —— 酸化物の3つの分類

:::exercise
source: slides:無機の基本４「酸素と酸化物」s38「練習１」（解答は s39）。⚠ スライドの問いにある H₂O は、酸性酸化物に入れない扱いがあるので除いた
prompt: 次の物質を (a) 酸性酸化物 (b) 両性酸化物 (c) 塩基性酸化物 に分類せよ。**Ag₂O　Al₂O₃　BaO　CO₂　CaO　Cl₂O₇　CuO　K₂O　MgO　NO₂　P₄O₁₀　PbO₂　SO₂　SO₃　SiO₂　SnO₂　ZnO**
answer: (a) CO₂・Cl₂O₇・NO₂・P₄O₁₀・SO₂・SO₃・SiO₂　(b) Al₂O₃・PbO₂・SnO₂・ZnO　(c) Ag₂O・BaO・CaO・CuO・K₂O・MgO
:::

:::section
anchor: periodic
title: 酸性・塩基性の強さと周期表
lead: 周期表の左の元素ほど水酸化物の塩基性が強く、右の元素ほどオキソ酸の酸性が強くなります。
codes:
- inorg.basis.period3-acidity
:::

:::table
caption: 第3周期の元素の酸化物（最高酸化数のもの）
source: slides:無機の基本４「酸素と酸化物」s16 の表（族・酸化物・分類・水酸化物/オキソ酸・水溶液の性質の5行×7列）
head:
- 族
- 酸化物
- 分類
- 水酸化物・オキソ酸
- 水溶液の性質
align: center | center | center | center | center
rows:
- 1 | Na₂O | 塩基性 | NaOH | 強塩基性
- 2 | MgO | 塩基性 | Mg(OH)₂ | 弱塩基性
- 13 | Al₂O₃ | 両性 | Al(OH)₃ | ——（水に溶けない）
- 14 | SiO₂ | 酸性 | H₂SiO₃ | ——（水に溶けない）
- 15 | P₄O₁₀ | 酸性 | H₃PO₄ | 弱酸性
- 16 | SO₃ | 酸性 | H₂SO₄ | 強酸性
- 17 | Cl₂O₇ | 酸性 | HClO₄ | 強酸性
:::

周期表の左の元素ほど陽性が強く、右の元素ほど陰性が強いためです（周期表のページ）。表の左端と右端、「NaOH は強塩基、H₂SO₄ と HClO₄ は強酸」は覚えておきます。

:::link
to: periodic-table
text: 陽性と陰性（周期表の位置）のページへ
:::

:::section
anchor: formula
title: 最高酸化数と酸化物の化学式
lead: 典型元素の最高酸化数は、族番号の一の位（価電子の数）と一致します。O²⁻ と組み合わせれば酸化物の化学式がつくれます。
terms:
- 最高酸化数
codes:
- inorg.basis.max-oxidation
:::

酸化数は「原子が失った電子の数」なので、価電子をすべて失ったときが最高酸化数です。16族の S は価電子が6個なので、最高酸化数は +6 です。

:::list
ordered: true
items:
- 族番号から最高酸化数を出す。
　○族なら最高酸化数は +（族番号の一の位）
- 酸化物イオン O²⁻ と電荷がつり合う数で組み合わせる。
　S⁶⁺ なら S⁶⁺ ＋ 3O²⁻ → SO₃
- 同じ酸化数のオキソ酸（または水酸化物）を思い出す。
　S が +6 のオキソ酸は H₂SO₄
:::

具体例: 15族の P は最高酸化数 +5 なので、2P⁵⁺ ＋ 5O²⁻ → P₂O₅ となります。実際には2つ分がつながった **P₄O₁₀**（十酸化四リン）の分子として存在します。同じ +5 のオキソ酸はリン酸 H₃PO₄ です。17族の Cl なら +7 で Cl₂O₇、オキソ酸は HClO₄ です。

**「どの元素が何族か」を常に意識してください。**族が分かれば、酸化物とオキソ酸の組が自分で出せます。

:::section
anchor: acidic-water
title: 酸性酸化物と水の反応
lead: 酸性酸化物は水と反応してオキソ酸になります。酸化数は変わりません。
codes:
- inorg.basis.oxide-water
- inorg.basis.oxide-ion-equation
:::

酸性酸化物と水の反応は酸化還元反応ではないので、**中心の原子の酸化数は変わりません**。同じ酸化数をもつ酸化物とオキソ酸の組が分かれば、あとは原子の数を合わせるだけで反応式が書けます。

:::reaction
left: SO₃ ＋ H₂O
right: H₂SO₄
level: ★★★
note: S は +6 のまま。三酸化硫黄から硫酸ができます。
:::

:::reaction
left: P₄O₁₀ ＋ 6H₂O
over: 加熱
right: 4H₃PO₄
level: ★★★
note: P は +5 のまま。十酸化四リンからリン酸ができます。
:::

:::reaction
left: Cl₂O₇ ＋ H₂O
right: 2HClO₄
level: ★★☆
note: Cl は +7 のまま。七酸化二塩素から過塩素酸ができます。
:::

:::reaction
left: CO₂ ＋ H₂O
right: H₂CO₃
level: ★★☆
note: C は +4 のまま。二酸化炭素から炭酸ができます。
:::

:::reaction
left: SO₂ ＋ H₂O
right: H₂SO₃
level: ★★☆
note: S は +4 のまま。二酸化硫黄から亜硫酸ができます。S の最高酸化数の化合物ではありません。
:::

## イオンを含む式で書く場合

CO₂ と SO₂ は水に溶けて弱い酸性を示します。弱酸なので、1段階目の電離までを含めたイオン反応式で書くほうがよく使われます。

:::reaction
left: CO₂ ＋ H₂O
arrow: ⇄
right: H⁺ ＋ HCO₃⁻
level: ★★★
note: CO₂ ＋ H₂O → H₂CO₃ と、H₂CO₃ の1段階目の電離を足した式です。
:::

:::reaction
left: SO₂ ＋ H₂O
arrow: ⇄
right: H⁺ ＋ HSO₃⁻
level: ★★★
note: SO₂ ＋ H₂O → H₂SO₃ と、H₂SO₃ の1段階目の電離を足した式です。
:::

## 二酸化窒素だけは酸化還元になる

:::reaction
left: 3NO₂ ＋ H₂O
right: 2HNO₃ ＋ NO
level: ★★★
note: N が +4 から +5（HNO₃）と +2（NO）に分かれます。NO₂ が酸化剤と還元剤の両方になる自己酸化還元反応です。
:::

この式は係数ごと覚えたほうが楽に書けます。H 原子に注目すると、H₂O 1個から HNO₃ が2個できるので「NO₂ : HNO₃ ＝ 3 : 2」と確かめながら覚えると効率的です。

:::link
to: nitrogen
text: 窒素の酸化物と硝酸のページへ
:::

## 例題 —— 酸性酸化物と水の反応

:::exercise
source: slides:無機の基本４「酸素と酸化物」s55「練習９」（解答は s56）
prompt: 次の変化を、(1)(2) はイオンを含む反応式で、(3) は化学反応式で書け。**(1) 二酸化炭素が水に溶けて酸性を示した　(2) 二酸化硫黄が水に溶けて酸性を示した　(3) 二酸化窒素が水に溶けた**
answer: (1) CO₂ ＋ H₂O ⇄ H⁺ ＋ HCO₃⁻　(2) SO₂ ＋ H₂O ⇄ H⁺ ＋ HSO₃⁻　(3) 3NO₂ ＋ H₂O → 2HNO₃ ＋ NO
:::

:::section
anchor: acidic-base
title: 酸性酸化物と塩基の反応
lead: 酸性酸化物は、対応するオキソ酸と同じように塩基と中和します。オキソ酸の中和の式から H₂O を引けば書けます。
codes:
- inorg.basis.oxide-neutralization
:::

## 具体例：SO₃ と NaOH

:::list
ordered: true
items:
- 対応するオキソ酸の中和の式を書く。
　H₂SO₄ ＋ 2NaOH → Na₂SO₄ ＋ 2H₂O
- 両辺から H₂O を1つ引く（H₂SO₄ − H₂O ＝ SO₃）。
　SO₃ ＋ 2NaOH → Na₂SO₄ ＋ H₂O
:::

H₂SO₄ が2価の酸なので、対応する SO₃ も2価の酸として反応します。逆に、酸化物の式の両辺に H₂O を足せばオキソ酸の式に戻ります。

:::reaction
left: SO₃ ＋ 2NaOH
right: Na₂SO₄ ＋ H₂O
level: ★★★
note: H₂SO₄ ＋ 2NaOH → Na₂SO₄ ＋ 2H₂O から H₂O を1つ引いた式です。
:::

:::reaction
left: CO₂ ＋ 2NaOH
right: Na₂CO₃ ＋ H₂O
level: ★★★
note: H₂CO₃ ＋ 2NaOH → Na₂CO₃ ＋ 2H₂O から H₂O を1つ引いた式です。
:::

:::reaction
left: SiO₂ ＋ 2NaOH
over: 加熱融解
right: Na₂SiO₃ ＋ H₂O
level: ★★★
note: CO₂ の式の C を、同じ14族の Si に置き換えた式です。ケイ酸ナトリウムができます。
:::

SiO₂ はガラスの主成分で、酸性酸化物ですが酸性は極めて弱く、**水とは反応しません**（SiO₂ ＋ H₂O → H₂SiO₃ とはならない）。ただし、塩基とともに加熱して融かすと、ほかの酸性酸化物と同じように反応します。SiO₂ が共有結合の結晶で、気体分子の CO₂ より反応しにくいためです。

:::link
to: carbon-silicon
text: 炭素とケイ素のページへ
:::

:::section
anchor: basic
title: 塩基性酸化物と水・酸の反応
lead: 塩基性酸化物は水と反応して水酸化物になり、対応する水酸化物と同じように酸と中和します。
:::

:::reaction
left: Na₂O ＋ H₂O
right: 2NaOH
level: ★★★
note: Na は +1 のまま。Na⁺ をもつ Na₂O と NaOH の組が分かれば、係数を合わせるだけです。
:::

:::reaction
left: CaO ＋ H₂O
right: Ca(OH)₂
level: ★★★
note: Ca は +2 のまま。酸化カルシウムから水酸化カルシウムができます。
:::

酸との反応も、水酸化物の中和の式から H₂O を引けば書けます。たとえば 2NaOH ＋ 2HCl → 2NaCl ＋ 2H₂O から H₂O を1つ引くと、Na₂O の式になります。

:::reaction
left: Na₂O ＋ 2HCl
right: 2NaCl ＋ H₂O
level: ★★★
note: NaOH が1価の塩基なので、2NaOH に対応する Na₂O は2価の塩基として反応します。
:::

:::reaction
left: CaO ＋ 2HCl
right: CaCl₂ ＋ H₂O
level: ★★★
note: Ca(OH)₂ ＋ 2HCl → CaCl₂ ＋ 2H₂O から H₂O を1つ引いた式です。
:::

## 例題 —— 塩基性酸化物と水・酸の反応

:::exercise
source: slides:無機の基本４「酸素と酸化物」s53「練習８」・s57「練習１０」・s59「練習１１」（解答は s54・s58・s60）
prompt: 次の化学反応式を書け。**(1) 十酸化四リンに水を加えて加熱した　(2) 七酸化二塩素が水と反応した　(3) 三酸化硫黄が水酸化ナトリウム水溶液と完全に中和した　(4) 二酸化ケイ素と水酸化ナトリウムを加熱融解した　(5) 酸化カリウムが水と反応した　(6) 酸化バリウムが水と反応した**
answer: (1) P₄O₁₀ ＋ 6H₂O → 4H₃PO₄　(2) Cl₂O₇ ＋ H₂O → 2HClO₄　(3) SO₃ ＋ 2NaOH → Na₂SO₄ ＋ H₂O　(4) SiO₂ ＋ 2NaOH → Na₂SiO₃ ＋ H₂O　(5) K₂O ＋ H₂O → 2KOH　(6) BaO ＋ H₂O → Ba(OH)₂
:::

:::section
anchor: amphoteric
title: 両性酸化物
lead: 両性酸化物は水には溶けませんが、酸とも強塩基とも反応して塩になります。
codes:
- inorg.basis.amphoteric-oxide
:::

酸との反応は、塩基性酸化物と同じ書き方です。強塩基との反応では、錯イオン（ヒドロキシド錯イオン）をもつ塩ができます。

:::reaction
left: Al₂O₃ ＋ 6HCl
right: 2AlCl₃ ＋ 3H₂O
level: ★★☆
note: 塩基として酸と反応します。
:::

:::reaction
left: Al₂O₃ ＋ 2NaOH ＋ 3H₂O
right: 2Na[Al(OH)₄]
level: ★★☆
note: 強塩基と反応して、テトラヒドロキシドアルミン酸ナトリウムになります。
:::

両性酸化物と両性水酸化物の反応は、両性金属のページでまとめて扱います。

:::link
to: amphoteric-metal
text: 両性金属（Al・Zn・Sn・Pb）のページへ
:::

:::section
anchor: naming
title: オキソ酸の名前 —— 過・亜・次亜
lead: 最も安定なオキソ酸を基準に、中心原子の酸化数が大きいものを「過〜」、小さいものを順に「亜〜」「次亜〜」と呼びます。
terms:
- オキソ酸
- 過塩素酸
- 亜塩素酸
- 次亜塩素酸
codes:
- inorg.basis.oxoacid-naming
- inorg.basis.oxoacid-def
:::

分子の中に酸素原子を含む酸を**オキソ酸**といいます。オキソ酸は、中心の原子の酸化数（結合している O 原子の数）で名前が変わります。

:::figure
src: oxoacid-naming.png
alt: 硝酸と亜硝酸、硫酸と亜硫酸、過塩素酸・塩素酸・亜塩素酸・次亜塩素酸の化学式と、中心原子の酸化数を並べた図。上ほど酸性が強い
caption: 中心原子の酸化数が大きいオキソ酸ほど、酸性が強くなります。
:::

具体例として塩素のオキソ酸を並べると、塩素酸 HClO₃（+5）を基準に、O が1つ多い HClO₄（+7）が**過塩素酸**、1つ少ない HClO₂（+3）が**亜塩素酸**、さらに1つ少ない HClO（+1）が**次亜塩素酸**です。同じように、硫酸 H₂SO₄（+6）に対して H₂SO₃（+4）が亜硫酸、硝酸 HNO₃（+5）に対して HNO₂（+3）が亜硝酸です。

塩の名前も同じ規則です。次亜塩素酸ナトリウム NaClO、塩素酸カリウム KClO₃、亜硫酸ナトリウム Na₂SO₃ のように、酸の名前の「酸」の後に金属の名前を付けます。

**「過・亜・次亜」の付け方と、塩素のオキソ酸4つの化学式は覚えてください。**同じ元素のオキソ酸では、酸化数が大きいほど酸性が強い、という向きもあわせて覚えます。

:::section
anchor: structure
title: オキソ酸の構造と配位結合
lead: 硝酸や硫酸の構造には、中心の原子から O 原子への配位結合が含まれます。
terms:
- 配位結合
codes:
- inorg.basis.oxoacid-structure
:::

一方の原子の非共有電子対を、ほかの原子と共有してできる結合を**配位結合**といいます。できた結合は、ふつうの共有結合と区別がつきません。

:::figure
src: oxoacid-coordinate-bond.png
alt: 水分子の電子式と、水分子の O 原子の非共有電子対に H⁺ が結合してオキソニウムイオンになる電子式
caption: 水の O 原子の非共有電子対を H⁺ と共有すると、オキソニウムイオン H₃O⁺ になります。配位結合すると、O 原子の結合の手が2本から3本に変わります。
:::

硫酸 H₂SO₄ では、中心の S 原子に2つの −OH が共有結合し、残りの2つの O 原子は S 原子の非共有電子対を受け取って配位結合しています。構造式では、配位結合を S から O への矢印で書くことがあります。

:::figure
src: sulfo-from-sulfuric.png
alt: 硫酸 H₂SO₄ の構造式と電子式。中心の S から O へ矢印で書いた配位結合が2本、H−O− が2本伸びている
caption: **硫酸 H₂SO₄**。S から O へ伸びる2本の矢印が配位結合です。
:::

:::figure
src: nitro-from-nitric.png
alt: 硝酸 HNO₃ の構造式と電子式。H−O−N と並び、N から O へ二重結合と、矢印で書いた配位結合が1本ずつ伸びている
caption: **硝酸 HNO₃**。N から O へ二重結合と配位結合が1本ずつ伸びています。
:::

**オキソ酸の構造式を書かせる問題はあまり多くありません。**硫酸と硝酸の形を見て、配位結合が含まれることが分かれば十分です。

:::link
to: functional-groups
text: 硝酸・硫酸から −OH を取った形（ニトロ基・スルホ基）は官能基のページへ
:::

:::section
anchor: range
title: 覚える範囲
lead: 酸化物の3分類と両性元素4つ、★★★ の反応式、過・亜・次亜の付け方を覚えます。
:::

**必ず覚えるもの**は次のとおりです。

:::list
items:
- 酸性酸化物・塩基性酸化物・両性酸化物の分け方と、両性元素 Al・Zn・Sn・Pb
- ★★★ の反応式（物質名から書けるように）
- 過・亜・次亜の付け方と、塩素のオキソ酸4つ
:::

★★★ の式はたくさんありますが、覚えるのは「どの酸化物がどのオキソ酸（水酸化物）に対応するか」の組だけです。係数は、族から酸化数を出し、中和の式から H₂O を引く手順で出せます。★★☆ の式（Cl₂O₇・両性酸化物）は、余裕があれば覚えてください。
