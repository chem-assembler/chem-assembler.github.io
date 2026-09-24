---
id: aromatic-homologs
unit: aro
unitLabel: 芳香族炭化水素
group: 同族体・誘導体
title: ベンゼンの同族体 —— 側鎖が付くと何が変わるか
summary: トルエン・キシレン・エチルベンゼン・スチレン・ナフタレンと、o-・m-・p- の呼び方、C₈H₁₀ の4種の数え方。そして「環は酸化されず、側鎖が −COOH になる」側鎖の酸化まで。
codes:
  - org.aro.toluene
  - org.aro.ortho-meta-para
  - org.aro.c8h10-isomers
  - org.aro.styrene
  - org.aro.naphthalene
  - org.aro.ortho-hbond
  - org.aro.sidechain-oxidation
  - org.aro.xylene-oxidation
  - org.aro.naphthalene-oxidation
source:
  - qa:芳香族炭化水素/同族体・誘導体
  - stages:ベンゼンとその同族体
  - compounds:エチルベンゼン・フタル酸・テレフタル酸・イソフタル酸・無水フタル酸
singleSource: false
why: トルエン・キシレン・スチレン・ナフタレンは名前も用途もばらばらに見えるが、このページの筋は「環は丈夫で、変化は側鎖で起こる」の1本で通る。名前と異性体（o・m・p と C₈H₁₀ の4種）を先に決めておかないと側鎖の酸化の行き先が読めないので、名前を前に、酸化を後ろに置いた。酸化の対応表は行が4本しかないので、alcohol-oxidation-map のように独立させず、ここに入れた。o- 体の分子内水素結合は教科書の本文の外側なので発展の節にした。芳香族には講義スライドが無いので、行の出どころは一問一答の知識項目台帳と反応式だけで、どの本の文も見ていない。①ドラフトなので推敲していない。
---

ベンゼン環の H を炭化水素基に置き換えたものを、ベンゼンの**同族体**といいます。環そのものは丈夫なので、同族体の反応はほとんどが**側鎖（環に付いた炭化水素基）**のところで起こります。

:::section
anchor: toluene
title: トルエン
lead: ベンゼンの H を1個メチル基に置き換えたもの。メチルベンゼンともいいます。
terms:
- トルエン
- 側鎖
codes:
- org.aro.toluene
:::

トルエン C₆H₅CH₃ は、ベンゼンの H を1個**メチル基 −CH₃** に置き換えた化合物で、**メチルベンゼン**ともいいます。特有のにおいをもつ無色の液体で、溶媒に使われます。

:::figure
src: aromatic-homologs-toluene.png
gen: name=トルエン plain
alt: トルエンの構造式。ベンゼン環の炭素1個にメチル基が結合している
caption: **トルエン C₆H₅CH₃**。環に付いたメチル基が、このページでいう「側鎖」です。
:::

:::section
anchor: omp
title: 二置換体の位置の呼び方 o・m・p
lead: 置換基が2個付いたとき、隣り合うものが o-、1つおきが m-、向かい合うものが p- です。
terms:
- オルト
- メタ
- パラ
- キシレン
codes:
- org.aro.ortho-meta-para
:::

ベンゼン環に置換基が2個付くと、2個の位置関係は3通りあります。**隣り合う（1,2-）ものを o-（オルト）**、**1つおき（1,3-）を m-（メタ）**、**向かい合う（1,4-）ものを p-（パラ）**といいます。

メチル基が2個付いたものが**キシレン** C₆H₄(CH₃)₂ で、位置によって o-キシレン・m-キシレン・p-キシレンの3種があります。

:::figure
src: aromatic-homologs-o-xylene.png
gen: name=o-キシレン plain
alt: o-キシレンの構造式。ベンゼン環の隣り合う2個の炭素に、メチル基が1個ずつ結合している
caption: **o-キシレン**。2個のメチル基が隣り合っています（1,2-）。
:::

:::figure
src: aromatic-homologs-m-xylene.png
gen: name=m-キシレン plain
alt: m-キシレンの構造式。ベンゼン環の炭素を1個はさんだ位置に、メチル基が1個ずつ結合している
caption: **m-キシレン**。2個のメチル基が1つおきに付いています（1,3-）。
:::

:::figure
src: aromatic-homologs-p-xylene.png
gen: name=p-キシレン plain
alt: p-キシレンの構造式。ベンゼン環の向かい合う2個の炭素に、メチル基が1個ずつ結合している
caption: **p-キシレン**。2個のメチル基が向かい合っています（1,4-）。
:::

**o・m・p の3つの位置の呼び方は必ず覚えてください。**「メチル基が2個なら『○○-キシレン』の ○○ に o・m・p を入れる」と、名前の型ごと覚えてしまうのが確実です。

:::section
anchor: c8h10
title: 分子式 C₈H₁₀ の芳香族炭化水素は4種
lead: ベンゼン環の外にある炭素2個を、1本にまとめるか2本に分けるかで場合分けします。
terms:
- エチルベンゼン
- 構造異性体
codes:
- org.aro.c8h10-isomers
:::

分子式 C₈H₁₀ の芳香族炭化水素は、ベンゼン環 C₆ の外に炭素が2個あります。次の手順で数えると、もれなく数えられます。

:::list
ordered: true
items:
- ベンゼン環の外にある炭素の数を数える。
　C₈H₁₀ なら 8−6＝2個
- その炭素を「1本の側鎖にまとめる」か「2本に分ける」かで場合分けする。
- まとめた場合は、側鎖の名前を付けて1種。
　炭素2個をまとめるとエチル基 → エチルベンゼンの1種
- 分けた場合は、2本の位置で o・m・p の3種。
　メチル基2本 → o-キシレン・m-キシレン・p-キシレンの3種
:::

合わせて **エチルベンゼン・o-キシレン・m-キシレン・p-キシレンの4種**です。

:::table
caption: 分子式 C₈H₁₀ の芳香族炭化水素（4種）
source: 上の手順（環の外の炭素2個を1本にまとめるか2本に分けるか）から出る4種と、側鎖の酸化の規則（根もとの炭素が −COOH になる）から出る行き先。一問一答の知識項目 org.aro.c8h10-isomers / org.aro.xylene-oxidation と同じ中身で、どの本の表も見ていない
head:
- 名称
- 側鎖
- 酸化して得られるもの
align: left | left | left
rows:
- **エチルベンゼン** | エチル基1本 | 安息香酸
- **o-キシレン** | メチル基2本が隣 | フタル酸
- **m-キシレン** | メチル基2本が1つおき | イソフタル酸
- **p-キシレン** | メチル基2本が向かい | テレフタル酸
:::

:::link
open: isomer
formula: C8H10
text: 分子式 C₈H₁₀ の芳香族炭化水素をアプリで書き出してみる（4種）
:::

## 例題 —— 分子式 C₈H₁₀ の芳香族炭化水素

紙に書いて解いてみてください。答え合わせは「解答を見る」から。

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-homologs の例題1（C₈H₁₀ の数え上げの手順から作った問い。どの本の問題も見ていない）
prompt: 分子式 C₈H₁₀ の芳香族炭化水素の名称をすべて答えよ。
answer: **エチルベンゼン・o-キシレン・m-キシレン・p-キシレン**の4種です。環の外の炭素2個を、1本にまとめる（エチル基）か、2本に分ける（メチル基2本で o・m・p）かで場合分けします。
:::

:::section
anchor: styrene-naphthalene
title: スチレンとナフタレン
lead: スチレンは環にビニル基が付いたもので、付加重合します。ナフタレンは環が2個つながったもので、昇華しやすい結晶です。
terms:
- スチレン
- ビニル基
- ナフタレン
- 縮合環
codes:
- org.aro.styrene
- org.aro.naphthalene
:::

スチレン C₆H₅CH=CH₂ は、ベンゼン環に**ビニル基 −CH=CH₂** が付いた化合物です。側鎖の C=C のところで**付加重合**して、ポリスチレンになります。

:::reaction
left: n CH₂=CH(C₆H₅)
right: ［CH₂−CH(C₆H₅)］ₙ
level: ★★☆
note: スチレンが付加重合してポリスチレンになります。反応するのは側鎖の C=C だけで、ベンゼン環はそのまま残ります。
:::

:::link
to: plastic
text: ポリスチレンなど、付加重合でできる合成樹脂のページへ
:::

ナフタレン C₁₀H₈ は、ベンゼン環2個が**1辺を共有してつながった**化合物です。**昇華しやすい無色の板状の結晶**で、防虫剤に使われます。

:::figure
src: aromatic-homologs-naphthalene.png
gen: name=ナフタレン plain
alt: ナフタレンの構造式。ベンゼン環2個が1本の辺を共有してつながっている
caption: **ナフタレン C₁₀H₈**。2個の環が真ん中の1辺を共有しています。
:::

:::section
anchor: oxidation
title: 側鎖の酸化 —— 環は酸化されない
lead: 過マンガン酸カリウムで酸化すると、側鎖は長さにかかわらず根もとの炭素1個だけが残って −COOH になります。
terms:
- 側鎖の酸化
- 安息香酸
- フタル酸
- テレフタル酸
- 無水フタル酸
codes:
- org.aro.sidechain-oxidation
- org.aro.xylene-oxidation
- org.aro.naphthalene-oxidation
:::

ベンゼン環に炭化水素基が付いた化合物を過マンガン酸カリウム KMnO₄ で酸化すると、**ベンゼン環は変化せず、側鎖だけが酸化されてカルボキシ基 −COOH になります**。

:::reaction
left: C₆H₅CH₃ ＋ 3［O］
over: KMnO₄
under: 加熱
right: C₆H₅COOH ＋ H₂O
level: ★★★
note: トルエンのメチル基がカルボキシ基になって、安息香酸ができます。
:::

**「側鎖はどんなに長くても、環に付いている根もとの炭素1個だけが残って −COOH になる」と覚えましょう。**たとえばエチルベンゼン C₆H₅CH₂CH₃ でも、酸化の後に残るのは、トルエンのときと同じ安息香酸です。

側鎖が2本あれば、2本とも −COOH になります。o-キシレンからは**フタル酸**、p-キシレンからは**テレフタル酸**ができます。

:::reaction
left: C₆H₄(CH₃)₂（o-キシレン）
over: KMnO₄
right: C₆H₄(COOH)₂（フタル酸）
gen: o-キシレン → フタル酸
level: ★★★
note: 2本のメチル基が、どちらもカルボキシ基になります。
:::

:::reaction
left: C₆H₄(CH₃)₂（p-キシレン）
over: KMnO₄
right: C₆H₄(COOH)₂（テレフタル酸）
gen: p-キシレン → テレフタル酸
level: ★★★
note: テレフタル酸は、ペットボトルの PET の原料です。
:::

フタル酸は2個の −COOH が隣り合っているので、加熱すると**分子内で脱水**して**無水フタル酸**になります。テレフタル酸は2個の −COOH が離れているので、分子内脱水は起こりません。

:::reaction
left: C₆H₄(COOH)₂（フタル酸）
over: 加熱
right: C₆H₄(CO)₂O ＋ H₂O
gen: フタル酸 → 無水フタル酸 ＋ 水
app: dehydration_anhydride
level: ★★☆
note: 無水フタル酸ができます。隣り合った o 体だけが起こすので、o 体かどうかを見分ける手がかりになります。
:::

ナフタレンを、酸化バナジウム(V) V₂O₅ を触媒にして空気中の酸素で酸化すると、片方の環が壊れて**無水フタル酸**になります。

:::reaction
left: 2C₁₀H₈ ＋ 9O₂
over: V₂O₅
right: 2C₆H₄(CO)₂O ＋ 4CO₂ ＋ 4H₂O
gen: 2 ナフタレン ＋ 9 酸素 → 2 無水フタル酸 ＋ 4 二酸化炭素 ＋ 4 水
level: ★☆☆
note: 無水フタル酸 C₈H₄O₃ の工業的な製法です。係数は覚えなくて構いません。
:::

**トルエン → 安息香酸、o-キシレン → フタル酸、p-キシレン → テレフタル酸の3本は必ず覚えてください。**ナフタレンの酸化は、触媒 V₂O₅ の名前と「無水フタル酸になる」ことだけ分かれば十分です。

:::link
to: aromatic-carboxylic-acid
text: できた安息香酸の性質は芳香族カルボン酸のページへ
:::

:::link
to: carboxylic-acid
text: カルボキシ基2個から水がとれる酸無水物（無水マレイン酸と同じ形）
:::

:::link
to: synthetic-fiber
text: テレフタル酸からつくる PET（ポリエチレンテレフタラート）のページへ
:::

## 例題 —— 側鎖の酸化

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-homologs の例題2を、m 体を選択肢から外して答えが1つに決まる形に直した問い（側鎖の酸化とフタル酸の分子内脱水から作った）
prompt: o-キシレンと p-キシレンのどちらかである化合物 A・B がある。それぞれを KMnO₄ で酸化して得た酸を加熱すると、A から得た酸だけが脱水した。A・B はそれぞれどちらか。
answer: **A は o-キシレン、B は p-キシレン**です。o-キシレンからはフタル酸ができ、2個の −COOH が隣り合っているので、加熱すると分子内脱水して無水フタル酸になります。p-キシレンからできるテレフタル酸は、−COOH が離れているので脱水しません。
:::

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-homologs の「根もとの炭素1個だけが残る」の規則から作った問い
prompt: エチルベンゼンを過マンガン酸カリウムで十分に酸化すると、何ができるか。
answer: **安息香酸 C₆H₅COOH** です。側鎖の長さにかかわらず、環に付いた根もとの炭素1個だけが −COOH になるので、トルエンを酸化したときと同じものができます。
:::

:::section
anchor: ortho-hbond
title: o- 体だけ性質が違うことがある
advanced: true
lead: 水素結合をつくれる置換基が隣り合う o- 体は、分子の中で水素結合をつくるので、m- 体・p- 体より沸点が低くなります。
terms:
- 分子内水素結合
codes:
- org.aro.ortho-hbond
:::

−OH や −COOH のように水素結合をつくれる置換基が隣り合っている o- 体は、**1つの分子の中で水素結合**をつくることができます。そのぶん**分子どうしの水素結合が減る**ので、m- 体や p- 体より**沸点や融点が低く、水に溶けにくく**なります。

たとえば o-ニトロフェノールは、分子内で −OH と −NO₂ が水素結合するので、p-ニトロフェノールより沸点が低くなります。サリチル酸でも同じことが起こります。

**この理由は覚えなくて構いませんが、「o- 体だけ沸点が低い」という結果を問題文で見たら、分子内水素結合を思い出せるようにしておきましょう。**

:::figure
src: aromatic-homologs-o-nitrophenol-hbond.png
gen: name=o-ニトロフェノール paper plain expand=NO2
mark: kind=破線 at=フェノール性ヒドロキシ基 to=ニトロ基 label=水素結合
alt: o-ニトロフェノールの構造式で、隣り合う −OH の H と −NO₂ の O が点線で結ばれ、「水素結合」と書いてある図
caption: o-ニトロフェノールでは、隣り合う **−OH の H** と **−NO₂ の O** が同じ分子の中で水素結合します（点線）。
:::

:::link
to: intermolecular-force
text: 水素結合と沸点の関係をもう少し詳しく
:::


