---
id: flame-color
unit: inorg.qual
unitLabel: イオンを見分ける
group: 炎色反応と水溶液の色
title: 炎色反応と水溶液の色
summary: 沈殿をつくらないアルカリ金属のイオンは、炎の色で見分けます。色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7元素だけ。あわせて、色のついたイオン（水溶液の色）をまとめました。
codes:
  - inorg.qual.flame-colors
  - inorg.qual.flame-procedure
  - inorg.qual.solution-colors
source:
  - muki:separation-model.js SEP_IONS の flame・SEP_OPS の flame（白金線・外炎・色が出るのは7元素だけ）
  - muki:akinator-deck-muki1.js FLAME（Ba の黄緑色）
  - muki:tree-model.js TREE_COLORS（Fe²⁺ 淡緑・Fe³⁺ 黄褐）
  - textbook:R5化学Vol.2-4編（炎色反応の図と、遷移元素のイオンの色・クロム酸と二クロム酸の本文の事実）
singleSource: false
why: スライドに炎色反応の回は無い。muki の型Bが炎色を「最初から押せる札」として持ち、色の名前とその割れ（K の赤紫／紫）まで在庫にあるので、それを表の土台にし、muki が持たない Li と Sr だけを教科書で確かめた。水溶液の色は「色でイオンを見分ける」という同じ問いへの答えなので同じページに置いたが、色のついたイオンは遷移元素に集まるので、表は短く、遷移元素の各ページへリンクで渡す形にした。
---

アルカリ金属のイオン（Na⁺・K⁺ など）は、どの試薬とも沈殿をつくりません。そのため沈殿の反応では見分けられず、**炎の色**で見分けます。

:::link
to: precipitate
text: 沈殿をつくる組み合わせと、沈殿しないもののページへ
:::

:::section
anchor: flame
title: 炎色反応 —— 色が出るのは7元素だけ
lead: 白金線に試料をつけて外炎に入れると、元素に特有の色が見えます。色が出るのは Li・Na・K・Ca・Sr・Ba・Cu の7つです。
terms:
- 炎色反応
- 白金線
- 外炎
:::

ある元素を含む物質を炎の中に入れると、その元素に特有の色が炎につきます。これを**炎色反応**といいます。

操作は次の順です。

:::list
ordered: true
items:
- 白金線を濃塩酸で洗い、バーナーの炎に入れて色が出なくなるまで焼く（前の試料を落とす）。
- 白金線の先に試料の水溶液をつける。
- バーナーの**外炎**に入れて、炎の色を見る。
:::

:::table
caption: 炎色反応の色
source: muki:separation-model.js SEP_IONS の flame（Na 黄・K 赤紫〈紫とも〉・Ca 橙赤・Cu 青緑）と muki:akinator-deck-muki1.js FLAME（Ba 黄緑）。Li 赤・Sr 紅は教科書の炎色反応の図の事実
head:
- 元素
- 炎の色
align: left | left
rows:
- リチウム Li | 赤
- ナトリウム Na | 黄
- カリウム K | 赤紫
- カルシウム Ca | 橙赤
- ストロンチウム Sr | 紅（深赤）
- バリウム Ba | 黄緑
- 銅 Cu | 青緑
:::

**この7元素と色の組は必ず覚えてください。**よく使われる語呂は「**リアカー無き K 村、動力借ると、するもくれない馬力**」で、Li 赤・Na 黄・K 紫・Cu 緑・Ca 橙・Sr 紅・Ba 緑、と読みます。

:::figure
src: flame-color-app-flame.png
shot: url=/muki/separation.html sel=#log li:first 状態=ページの JS で window.sepUI.state.truth を Na・K・Ca・Cu・Ag に順に固定し、history を空にしてから sepUI.doOp('flame') を押した5枚を、1手目の札の文を切り落として縦に並べた（separation.html は開くたびに抽選なので、状態をページの JS で作った）・viewport 1200・deviceScaleFactor 1
alt: 暗い地の画面に、炎の色の見本と「炎が○○色になった」という文が5段並んでいる。上から黄色、赤紫色、橙赤色、青緑色、そして最後は色の見本が空で「炎に色はつかなかった」
caption: 系統分離の画面で炎色反応の札を押したときの結果。上から Na⁺・K⁺・Ca²⁺・Cu²⁺・Ag⁺ を入れた容器です。**Ag⁺ のように、7元素以外は炎に色がつきません。**
:::

:::callout
tone: caution
text: K の炎の色は「赤紫」とも「紫」とも書かれます。Na の黄色が強く出るので、K の色は Na が混ざると見えにくく、コバルトガラスを通して見ることがあります。答えるときは「赤紫」と書けば十分です。
:::

**Mg と Be は2族ですが、炎色反応を示しません。**同じ2族の Ca・Sr・Ba とは分けて覚えましょう。

## なぜ色が出るのか

炎の熱で原子の電子がエネルギーの高い状態に移り、もとの状態にもどるときに、差のエネルギーを光として出します。この差が元素ごとに決まっているので、出る光の色も元素ごとに決まります。

**仕組みは覚えなくても構いません。**「元素ごとに決まった色が出る」ことだけ押さえておけば十分です。花火の色は、この炎色反応を使っています。

## 例題 —— 炎色反応

:::exercise
source: 自作（炎色反応の表の7元素と色の対応を問う）
prompt: 次の元素の炎色反応の色を答えよ。**(1) Na　(2) K　(3) Ca　(4) Ba　(5) Cu　(6) Li**
answer: (1) 黄　(2) 赤紫　(3) 橙赤　(4) 黄緑　(5) 青緑　(6) 赤
:::

:::exercise
source: 自作（沈殿と炎色の組み合わせ。muki の型Bと同じ「候補から1つに決める」問い）
prompt: NaCl・KCl・CaCl₂ のどれか1つの水溶液がある。(1) 炭酸ナトリウム水溶液を加えても沈殿は生じなかった。(2) 炎色反応を調べると赤紫色だった。この物質は何か。
answer: KCl です。(1) で白色の CaCO₃ が沈殿しないので Ca²⁺ ではないと分かり、(2) の赤紫色で K⁺ と決まります。Na⁺ なら炎は黄色です。
:::

:::section
anchor: solution
title: 色のついたイオン —— 水溶液の色
lead: 典型元素のイオンはほとんど無色です。色がついているのは遷移元素のイオンと、それを含む多原子イオン・錯イオンです。
terms:
- 遷移元素
- 錯イオン
:::

水溶液の色も、イオンを見分ける手がかりになります。まず、**典型元素のイオン（Na⁺・Ca²⁺・Al³⁺・Zn²⁺・Cl⁻・SO₄²⁻ など）は無色**です。色がついているのは、遷移元素のイオンに限られます。

:::table
caption: 色のついたイオン
source: muki:chemistry.js ANIONS/CATIONS の aqueous（Cu²⁺ 青・Fe²⁺ 淡緑）、muki:tree-model.js TREE_COLORS（Fe³⁺ 黄褐）、muki:separation-model.js SEP_TABLE（[Cu(NH₃)₄]²⁺ 深青）と、教科書の遷移元素のイオンの色・クロム酸と二クロム酸・過マンガン酸の本文の事実
head:
- イオン
- 水溶液の色
align: left | left
rows:
- 銅(II)イオン Cu²⁺ | 青
- テトラアンミン銅(II)イオン [Cu(NH₃)₄]²⁺ | 深青
- 鉄(II)イオン Fe²⁺ | 淡緑
- 鉄(III)イオン Fe³⁺ | 黄褐
- ニッケル(II)イオン Ni²⁺ | 緑
- マンガン(II)イオン Mn²⁺ | 淡桃（ほぼ無色）
- クロム酸イオン CrO₄²⁻ | 黄
- 二クロム酸イオン Cr₂O₇²⁻ | 橙赤
- 過マンガン酸イオン MnO₄⁻ | 赤紫
:::

**Cu²⁺ 青・Fe²⁺ 淡緑・Fe³⁺ 黄褐・MnO₄⁻ 赤紫の4つは必ず覚えてください。**MnO₄⁻ の赤紫が Mn²⁺ の淡桃（ほぼ無色）に変わる変化は、酸化還元滴定の終点の目印に使われます。

:::link
to: transition-oxidizers
text: 二クロム酸イオン・過マンガン酸イオンの色の変化はクロムとマンガンのページへ
:::

:::link
to: iron
text: Fe²⁺ と Fe³⁺ の見分け方は鉄のページへ
:::

:::link
to: complex-ion
text: [Cu(NH₃)₄]²⁺ など、錯イオンの色と形のページへ
:::

:::mistake
wrong: 炎色反応の色と、水溶液の色は同じ
right: 別のものです。Cu は炎の色が**青緑**で、水溶液（Cu²⁺）の色は**青**。Na は炎が**黄**ですが、水溶液の Na⁺ は**無色**です。
why: どちらも「その元素の色」と覚えてしまうためです。★ 炎色反応は炎に入れたときの光の色、水溶液の色はイオンが溶けているときの色、と場面で分けて覚えましょう。
:::

## 例題 —— 色のついたイオン

:::exercise
source: 自作（水溶液の色の表から、色の変化を問う）
prompt: 硫酸酸性の過マンガン酸カリウム水溶液に、過酸化水素水を少しずつ加えた。水溶液の色はどう変わるか。
answer: 赤紫色（MnO₄⁻）から、ほぼ無色（Mn²⁺、淡桃色）に変わります。
:::

:::section
anchor: range
title: 覚える範囲
lead: 炎色反応の7元素と色、色のついたイオンの代表4つです。
:::

**次の2つは必ず覚えてください。**

:::list
items:
- 炎色反応: Li 赤・Na 黄・K 赤紫・Ca 橙赤・Sr 紅・Ba 黄緑・Cu 青緑（Mg・Be は示さない）
- 水溶液の色: Cu²⁺ 青・Fe²⁺ 淡緑・Fe³⁺ 黄褐・MnO₄⁻ 赤紫（典型元素のイオンは無色）
:::

炎色反応の仕組み（電子のエネルギー）と、Ni²⁺ の色は、覚えなくても構いません。

:::link
to: cation-separation
text: 沈殿と炎色反応を組み合わせて、金属イオンを順に分けるページへ
:::
