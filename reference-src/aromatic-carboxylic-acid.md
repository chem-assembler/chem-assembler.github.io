---
id: aromatic-carboxylic-acid
unit: aroN
unitLabel: 芳香族窒素化合物・芳香族の分離
group: 芳香族カルボン酸
title: 芳香族カルボン酸とサリチル酸
summary: 安息香酸とサリチル酸のまとめ。サリチル酸はカルボン酸でもありフェノール類でもあるので、無水酢酸なら −OH が、メタノールなら −COOH が反応して、2つの医薬品に分かれます。
codes:
  - org.aroN.benzoic
  - org.aroN.salicylic
  - org.aroN.aspirin
  - org.aroN.methyl-salicylate
  - org.aroN.aromatic-acid-tests
  - org.aroN.salicylic-derivatives-distinguish
source:
  - qa:芳香族窒素化合物/芳香族カルボン酸
  - stages:芳香族カルボン酸とエステル
  - compounds:安息香酸ナトリウム・サリチル酸ナトリウム
singleSource: false
why: 芳香族カルボン酸を引きに来る人が探すのは、ほとんどが「アセチルサリチル酸とサリチル酸メチルはどう違うか」で、これはサリチル酸が −OH と −COOH の両方をもち、どちらの基が反応したかで行き先が2つに分かれる、という1つのことから出ている。だから安息香酸は「環に直接 −COOH が付いたカルボン酸」として1節で済ませ、残りをサリチル酸の分岐に充てた。知識項目は4件と少ないが、合流先を探すと、側鎖の酸化（aromatic-homologs）に入れればそのページの主題が2つに割れ、分離（aromatic-separation）に入れれば主題が物質と操作の2つになるので、独立のページにした。芳香族には講義スライドが無いので、行の出どころは一問一答の知識項目台帳と反応式だけで、どの本の文も見ていない。①ドラフトなので推敲していない。
---

ベンゼン環にカルボキシ基 −COOH が直接結合した化合物を、**芳香族カルボン酸**といいます。カルボン酸としての性質は鎖式のカルボン酸と同じですが、サリチル酸だけは −OH も合わせもつので、特別な扱いが要ります。

:::section
anchor: benzoic
title: 安息香酸
lead: 環に −COOH が直接付いたいちばん簡単な芳香族カルボン酸。炭酸より強い酸で、NaHCO₃ と反応して CO₂ を出します。
terms:
- 芳香族カルボン酸
- 安息香酸
:::

**安息香酸 C₆H₅COOH** は、ベンゼン環にカルボキシ基が直接付いた化合物です。**白色の結晶**で、水に少し溶け、水溶液は弱い酸性を示します。食品の防腐剤に使われます。

:::figure
src: aromatic-carboxylic-acid-benzoic.png
gen: name=安息香酸 plain
alt: 安息香酸の構造式。ベンゼン環の炭素1個にカルボキシ基が直接結合している
caption: **安息香酸 C₆H₅COOH**。トルエンの側鎖を酸化すると、この形になります。
:::

安息香酸はカルボン酸なので、**炭酸より強い酸**です。炭酸水素ナトリウム水溶液に加えると、**二酸化炭素を出して溶けます**。

:::reaction
left: C₆H₅COOH ＋ NaHCO₃
right: C₆H₅COONa ＋ H₂O ＋ CO₂↑
level: ★★★
note: 安息香酸ナトリウムができます。フェノールはこの反応を起こさないので、ここがフェノールとの見分けどころです。
:::

:::link
to: carboxylic-acid
text: カルボン酸に共通の性質（炭酸より強い・弱酸の遊離）はカルボン酸のページへ
:::

:::link
to: aromatic-homologs
text: トルエンを酸化して安息香酸をつくる（側鎖の酸化）
:::

:::section
anchor: salicylic
title: サリチル酸 —— 2つの性質をもつ
lead: −OH と −COOH が o の位置に並んだ化合物。1つの分子が、カルボン酸としてもフェノール類としてもふるまいます。
terms:
- サリチル酸
:::

**サリチル酸 C₆H₄(OH)COOH** は、ベンゼン環に**ヒドロキシ基 −OH とカルボキシ基 −COOH が隣り合って（o の位置に）**付いた化合物です。そのため、**カルボン酸の性質とフェノール類の性質を両方**示します。

:::figure
src: aromatic-carboxylic-acid-salicylic.png
gen: name=サリチル酸 plain
alt: サリチル酸の構造式。ベンゼン環の隣り合う2個の炭素に、ヒドロキシ基とカルボキシ基が1個ずつ結合している
caption: **サリチル酸**。−OH（フェノール類の部分）と −COOH（カルボン酸の部分）が隣り合っています。
:::

:::table
caption: 安息香酸・フェノール・サリチル酸は2つの試薬でこう応じる
source: 酸の強さの順番（カルボン酸 ＞ 炭酸 ＞ フェノール）から出る NaHCO₃ への応じ方と、フェノール性 −OH の塩化鉄(III) 呈色（org.phenol.fecl3）から出る行。一問一答の知識項目 org.aroN.salicylic と同じ中身で、どの本の表も見ていない
head:
- 試薬
- 安息香酸
- フェノール
- サリチル酸
align: left | left | left | left
rows:
- **NaHCO₃ 水溶液** | CO₂ を出して溶ける | 反応しない | **CO₂ を出して溶ける**
- **FeCl₃ 水溶液** | 呈色しない | 紫色に呈色する | **赤紫色に呈色する**
:::

**「両方の試薬に応じるのはサリチル酸だけ」と覚えましょう。**NaHCO₃ に応じるのは −COOH のはたらき、FeCl₃ に応じるのは環に付いた −OH のはたらきです。

:::link
to: phenol-reactions
text: 塩化鉄(III) による呈色（フェノール類の検出）
:::

:::section
anchor: branch
title: どちらの基が反応するかで行き先が分かれる
lead: 無水酢酸では −OH がアセチル化されてアセチルサリチル酸に、メタノールでは −COOH がエステル化されてサリチル酸メチルになります。
terms:
- アセチルサリチル酸
- サリチル酸メチル
- アスピリン
:::

サリチル酸は反応できる基を2つもつので、**相手の試薬によって、反応する基が変わります**。どちらの場合もエステルができますが、エステルになった基が違います。

サリチル酸に**無水酢酸**を作用させると、**−OH のほう**がアセチル化されて、**アセチルサリチル酸**になります。**アスピリン**の名で**解熱鎮痛剤**に使われます。

:::reaction
left: C₆H₄(OH)COOH ＋ (CH₃CO)₂O
right: C₆H₄(OCOCH₃)COOH ＋ CH₃COOH
gen: サリチル酸 ＋ 無水酢酸 → アセチルサリチル酸 ＋ 酢酸
app: acetylation
level: ★★★
note: アセチルサリチル酸ができます。−OH が −OCOCH₃ に変わり、−COOH は残っています。
:::

:::figure
src: aromatic-carboxylic-acid-aspirin.png
gen: name=アセチルサリチル酸 plain
alt: アセチルサリチル酸の構造式。ベンゼン環の隣り合う炭素に、アセチル化された酸素の基とカルボキシ基が付いている
caption: **アセチルサリチル酸**。−OH がアセチル化され、−COOH はそのまま残っています。
:::

サリチル酸に**メタノール**と少量の濃硫酸を加えて温めると、**−COOH のほう**がエステル化されて、**サリチル酸メチル**になります。**消炎鎮痛剤（湿布薬）**に使われます。

:::reaction
left: C₆H₄(OH)COOH ＋ CH₃OH
over: 濃硫酸
right: C₆H₄(OH)COOCH₃ ＋ H₂O
gen: サリチル酸 ＋ メタノール → サリチル酸メチル ＋ 水
app: esterification
level: ★★★
note: サリチル酸メチルができます。−COOH が −COOCH₃ に変わり、−OH は残っています。
:::

:::figure
src: aromatic-carboxylic-acid-methyl-salicylate.png
gen: name=サリチル酸メチル plain
alt: サリチル酸メチルの構造式。ベンゼン環の隣り合う炭素に、ヒドロキシ基とメチルエステルの基が付いている
caption: **サリチル酸メチル**。−COOH がエステル化され、−OH はそのまま残っています。
:::

**2つの医薬品の名前・用途と、「どちらの基が反応したか」は必ず覚えてください。**構造式を書かせる問題もよく登場します。反応の細かい条件は覚えなくて構いません。

:::mistake
wrong: アセチルサリチル酸もサリチル酸メチルも、サリチル酸の −COOH がエステルになったものである。
right: アセチルサリチル酸は −OH がアセチル化されたもの（−COOH が残る）、サリチル酸メチルは −COOH がエステル化されたもの（−OH が残る）。
why: どちらも「エステル」なので混ざりやすいところです。残っている基を見れば、NaHCO₃ と FeCl₃ への応じ方がそのまま決まります。
:::

:::link
to: esterification
text: カルボン酸とアルコールのエステル化そのものは、エステル化のページへ
:::

:::link
to: aniline
text: 同じ無水酢酸でアニリンをアセチル化する
:::

## 例題

紙に書いて解いてみてください。答え合わせは「解答を見る」から。

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-carboxylic-acid の例題1（アセチル化で −OH がふさがることから作った問い。どの本の問題も見ていない）
prompt: サリチル酸に無水酢酸を作用させて得られる化合物は、塩化鉄(III) 水溶液で呈色するか。
answer: **呈色しません。**アセチル化されたのは −OH のほうなので、フェノール性の −OH が残っていないためです。逆に、サリチル酸メチルは −OH が残っているので呈色します。
:::

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-carboxylic-acid の例題2（残っている基と NaHCO₃ への応じ方から作った問い）
prompt: サリチル酸メチルとアセチルサリチル酸を、炭酸水素ナトリウム水溶液で見分けられるか。
answer: **見分けられます。**アセチルサリチル酸は −COOH が残っているので CO₂ を出して溶けます。サリチル酸メチルは −COOH がエステルになっているので反応しません。
:::

:::exercise
source: draft:reference-outline/aromatic.md の aromatic-carboxylic-acid の例題3（o 体の分子内水素結合から作った問い）
prompt: サリチル酸の −OH と −COOH が隣り合っている（o の位置にある）ことは、融点にどう効くか。
answer: −OH と −COOH が**分子内で水素結合**をつくるので、そのぶん分子どうしの水素結合が減り、p-ヒドロキシ安息香酸（p 体）より**融点が低く**なります。
:::

:::example
stageId: salicylic-acid
lead: サリチル酸を組んで、−OH と −COOH が隣り合っていることを手で確かめます。
note: 2つの基を向かい合う位置に付けると、別の化合物（p-ヒドロキシ安息香酸）になります。
:::
