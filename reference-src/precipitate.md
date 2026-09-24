---
id: precipitate
unit: inorg.qual
unitLabel: イオンを見分ける
group: 沈殿の生成と色
title: 沈殿の生成と色
summary: どの陰イオンが、どの陽イオンと沈殿をつくるかを、陰イオンごとに並べました。色と「酸に溶けるか」も一緒に覚えます。硫化物だけは、液性で沈むかどうかが変わります。
codes:
  - inorg.qual.soluble-salts
  - inorg.qual.chloride-sulfate-ppt
  - inorg.qual.sulfate-vs-carbonate
  - inorg.qual.hydroxide-colors
  - inorg.qual.sulfide-ph
  - inorg.qual.sulfide-colors
source:
  - slides:無機の基本５「ハロゲン」s12（ハロゲン化銀の比較）・s27（Ag⁺＋Cl⁻、Pb²⁺＋2Cl⁻）・練習５
  - slides:無機の基本６「硫黄」s11（硫化物の沈殿と色・イオン化傾向と沈殿しやすさ）・s22（BaSO₄・CaSO₄）・練習１（沈殿の色）
  - textbook:R5化学Vol.2-4編（金属イオンの分離と確認の節の沈殿反応）
  - muki:chemistry.js PRECIPITATES・separation-model.js SEP_TABLE・tree-model.js（クロム酸塩）
singleSource: false
why: 沈殿の知識は陽イオンの側から覚えると「Ag⁺ は何と沈むか」を元素の数だけくり返すことになり、系統分離の試薬（希塩酸・硫化水素・アンモニア水・炭酸アンモニウム）とも対応しない。試薬を入れるときに見ているのは陰イオンなので、陰イオンごとに「沈む相手・色・酸に溶けるか」を並べた。沈殿の色と組み合わせはスライド（無機５・６）と muki の在庫で足り、足りないクロム酸塩だけを教科書で確かめた。沈殿が過剰の試薬に溶ける話（両性・錯イオン）は主題が別なので、一言とリンクにした。
---

水溶液どうしを混ぜたとき、陽イオンと陰イオンが水に溶けにくい組み合わせになると、固体が生じて沈みます。これを**沈殿**といい、化学反応式では沈殿する物質に「↓」を付けて書きます。

沈殿をつくる組み合わせは、**陰イオンの側から覚える**と整理できます。系統分離で加える試薬（希塩酸・希硫酸・硫化水素・アンモニア水・炭酸アンモニウム）は、どれも**決まった陰イオンを入れる操作**だからです。

:::link
to: inorg-reaction-types
text: 沈殿を含む、無機の反応の5つの型の入口のページへ
:::

:::section
anchor: rule
title: まず「沈殿しないもの」を覚える
lead: Na⁺・K⁺・NH₄⁺ の塩と、硝酸塩 NO₃⁻ は、どんな組み合わせでも水に溶けます。
terms:
- 沈殿
- イオン反応式
codes:
- inorg.qual.soluble-salts
:::

沈殿を覚えるときは、**沈殿しないもの**を先に押さえると量が減ります。

:::list
items:
- **Na⁺・K⁺ などアルカリ金属のイオンと NH₄⁺ の塩は、すべて水に溶ける**
- **硝酸塩（NO₃⁻ の塩）は、すべて水に溶ける**
:::

そのため、硝酸銀 AgNO₃・硝酸鉛(II) Pb(NO₃)₂ や、NaCl・Na₂SO₄・Na₂S などは、沈殿をつくる**試薬の側**として使われます。沈殿の反応式は、試薬のうちの「沈まないイオン」を省いたイオン反応式で書くのが基本です。

:::reaction
left: AgNO₃ ＋ NaCl
right: AgCl↓ ＋ NaNO₃
level: ★★★
note: イオン反応式では Ag⁺ ＋ Cl⁻ → AgCl。Na⁺ と NO₃⁻ は溶けたまま残るので省きます。
:::

:::link
app: ion-equation
id: s4
text: 硝酸銀と塩化ナトリウム（沈殿）
:::

アルカリ金属のイオンはどの試薬とも沈殿をつくらないので、**炎色反応**で見分けます。

:::link
to: flame-color
text: 炎色反応とイオンの色のページへ
:::

:::section
anchor: by-anion
title: 陰イオンごとの沈殿
lead: Cl⁻・SO₄²⁻・CO₃²⁻・CrO₄²⁻ の4つは、沈む相手が少ないので名前で覚えます。
terms:
- 塩化銀
- 硫酸バリウム
- 炭酸カルシウム
- クロム酸鉛(II)
codes:
- inorg.qual.chloride-sulfate-ppt
- inorg.qual.sulfate-vs-carbonate
:::

:::table
caption: 陰イオンごとの沈殿と色
source: slides:無機の基本５ s12・s27（Cl⁻ の沈殿）・無機の基本６ s22・練習１（SO₄²⁻ の沈殿、HNO₃ では沈殿しない）と muki:chemistry.js PRECIPITATES（CO₃²⁻ の沈殿）。CrO₄²⁻ の行は muki:tree-model.js の TREE_REF_CRO4_WHO と教科書で確かめた事実。「酸に溶けるか」の欄は教科書の沈殿反応の本文の事実
head:
- 加える陰イオン
- 沈殿する陽イオン
- 沈殿と色
- 強酸を加えると
align: left | left | left | left
rows:
- 塩化物イオン Cl⁻ | Ag⁺・Pb²⁺ | AgCl（白）・PbCl₂（白） | 溶けない
- 硫酸イオン SO₄²⁻ | Ca²⁺・Ba²⁺・Pb²⁺ | CaSO₄（白）・BaSO₄（白）・PbSO₄（白） | 溶けない
- 炭酸イオン CO₃²⁻ | Ca²⁺・Ba²⁺ など | CaCO₃（白）・BaCO₃（白） | CO₂ を出して溶ける
- クロム酸イオン CrO₄²⁻ | Ag⁺・Pb²⁺・Ba²⁺ | Ag₂CrO₄（暗赤・赤褐とも）・PbCrO₄（黄）・BaCrO₄（黄） | ——
:::

:::figure
src: precipitate-app-list.png
shot: url=/muki/snake.html sel=.dict-section:nth(2)（「全沈殿リスト」）を y=170〜900 で切り取り 状態=「イオン図鑑を開く」を押しただけ（抽選なし）・viewport 1200×2600・deviceScaleFactor 1・256色に減色
alt: 暗い地の画面に、陽イオンと陰イオンの組み合わせと、できる沈殿が1行ずつ並んだ一覧。AgCl は白、Ag₂O は褐色、Cu(OH)₂ は青白色、CuCO₃ は青緑色の文字で書かれ、BaSO₄・BaCO₃・CaSO₄・CaCO₃ は白い文字
caption: 沈殿の一覧の画面。**沈殿の化学式の文字の色が、沈殿の色**です（イオンの文字の色は見分けるための色で、水溶液の色ではありません）。
:::

**Cl⁻ で沈むのは Ag⁺ と Pb²⁺ だけ、SO₄²⁻ で沈むのは Ca²⁺・Ba²⁺・Pb²⁺ だけ**と、相手の名前で覚えてください。どれも白色なので、色では区別できません。

:::reaction
left: Ag⁺ ＋ Cl⁻
right: AgCl↓
level: ★★★
note: 白色。Cl⁻ の検出に使います。
:::

:::reaction
left: Pb²⁺ ＋ 2Cl⁻
right: PbCl₂↓
level: ★★★
note: 白色。PbCl₂ は**熱水には溶けます**（AgCl は溶けない）。
:::

:::reaction
left: Ba²⁺ ＋ SO₄²⁻
right: BaSO₄↓
level: ★★★
note: 白色。強酸にも溶けないので、X 線の造影剤に使われます。
:::

:::reaction
left: Ca²⁺ ＋ CO₃²⁻
right: CaCO₃↓
level: ★★★
note: 白色。強酸を加えると CO₂ を出して溶けます（弱酸の遊離）。
:::

硫酸塩と炭酸塩は、どちらも白い沈殿です。**見分けるときは強酸を加えます。**炭酸塩は弱酸の塩なので、強酸を加えると CO₂ を出して溶けますが、硫酸塩は溶けません。

:::callout
tone: caution
text: CaSO₄ はほかの硫酸塩より水に溶けやすく、うすい溶液では沈殿しないことがあります。試験では「Ca²⁺ ＋ SO₄²⁻ で白色沈殿」として扱って構いません。
:::

## ハロゲン化銀の色

Cl⁻ のなかまのハロゲン化物イオンも、Ag⁺ と沈殿をつくります。色が少しずつ違うので、ハロゲンの見分けに使えます。

:::table
caption: ハロゲン化銀の色
source: slides:無機の基本５「ハロゲン」s12「ハロゲン化銀の比較」の表の事実（AgF は水に溶ける・AgCl 白・AgBr 淡黄・AgI 黄）
head:
- ハロゲン化銀
- 水への溶けやすさ
- 色
align: left | left | left
rows:
- AgF | 溶ける | ——
- AgCl | 溶けない | 白
- AgBr | 溶けない | 淡黄
- AgI | 溶けない | 黄
:::

**AgF だけは水に溶けることと、AgCl 白・AgBr 淡黄・AgI 黄の3色は覚えてください。**ハロゲン化銀は光で分解して銀が遊離し、黒ずみます（感光性）。

:::link
to: halogen
text: ハロゲンを並べて比べるページへ
:::

## 例題 —— 陰イオンごとの沈殿

:::exercise
source: slides:無機の基本６「硫黄」s33-34「練習１」（沈殿の色。SO₄²⁻ で Ba・Ca・Pb が白、Cl⁻ で Ag・Pb が白、HNO₃ では沈殿しない）と同じ形の問い
prompt: 次の操作で沈殿が生じるものはどれか。生じる場合は沈殿の化学式と色を答えよ。**(1) 塩化バリウム水溶液に希硫酸を加えた　(2) 硝酸銀水溶液に塩酸を加えた　(3) 硝酸カルシウム水溶液に希硝酸を加えた　(4) 硝酸鉛(II) 水溶液に塩酸を加えた**
answer: (1) BaSO₄（白）　(2) AgCl（白）　(3) 沈殿しない（硝酸塩はすべて水に溶ける）　(4) PbCl₂（白）
:::

:::section
anchor: hydroxide
title: 水酸化物イオン OH⁻ による沈殿
lead: 多くの金属イオンが水酸化物の沈殿をつくります。色と、過剰の試薬に溶けるかどうかがポイントです。
terms:
- 水酸化物
- 両性水酸化物
codes:
- inorg.qual.hydroxide-colors
:::

NaOH 水溶液やアンモニア水を少量加えると、アルカリ金属・2族（Ca²⁺・Ba²⁺）以外の多くの金属イオンが水酸化物の沈殿をつくります。

:::table
caption: 水酸化物の沈殿と色
source: muki:chemistry.js PRECIPITATES と muki:separation-model.js SEP_TABLE の nh3・naoh の欄（色と、過剰で溶けるか）。Fe³⁺ の沈殿の書き方は教科書の本文の事実
head:
- イオン
- 沈殿と色
- 過剰の NaOH で
- 過剰の NH₃ 水で
align: left | left | center | center
rows:
- Al³⁺ | Al(OH)₃（白） | 溶ける | 溶けない
- Zn²⁺ | Zn(OH)₂（白） | 溶ける | 溶ける
- Pb²⁺ | Pb(OH)₂（白） | 溶ける | 溶けない
- Cu²⁺ | Cu(OH)₂（青白） | 溶けない | 溶ける（深青色）
- Ag⁺ | Ag₂O（褐） | 溶けない | 溶ける
- Fe²⁺ | Fe(OH)₂（緑白） | 溶けない | 溶けない
- Fe³⁺ | FeO(OH)（赤褐） | 溶けない | 溶けない
:::

Ag⁺ だけは水酸化物ではなく、**酸化銀 Ag₂O**（褐色）が沈殿します。

:::reaction
left: 2Ag⁺ ＋ 2OH⁻
right: Ag₂O↓ ＋ H₂O
level: ★★★
note: 褐色。AgOH ではなく Ag₂O と書きます。
:::

:::reaction
left: Cu²⁺ ＋ 2OH⁻
right: Cu(OH)₂↓
level: ★★★
note: 青白色。
:::

鉄(III)イオンの赤褐色の沈殿は、酸化水酸化鉄(III) FeO(OH) と書きます。古い本では Fe(OH)₃ と書かれますが、実際には決まった組成をもたない沈殿で、どちらも同じものです。**「赤褐色の沈殿」**と答えられれば十分です。


「過剰の NaOH に溶ける」のは**両性**の水酸化物（Al・Zn・Pb）、「過剰の NH₃ 水に溶ける」のは**アンモニアと錯イオンをつくる**もの（Zn・Cu・Ag）です。**Zn だけがどちらにも溶けます。**溶ける仕組みは、それぞれのページが持っています。

:::link
to: amphoteric-metal
text: 過剰の NaOH に溶ける両性の水酸化物のページへ
:::

:::link
to: complex-ion
text: 過剰のアンモニア水に溶けて錯イオンになるページへ
:::

:::section
anchor: sulfide
title: 硫化物イオン S²⁻ による沈殿 —— 液性で変わる
lead: 硫化水素を通したとき、酸性でも沈むのはイオン化傾向の小さい金属だけ。Zn・Fe などは中性・塩基性でしか沈みません。
terms:
- 硫化物
- 硫化水素
codes:
- inorg.qual.sulfide-ph
- inorg.qual.sulfide-colors
:::

硫化水素 H₂S を通すと、多くの金属イオンが硫化物の沈殿をつくります。ただし、**液性によって沈むものが変わります。**

H₂S は弱酸で、H₂S ⇄ 2H⁺ ＋ S²⁻ のように電離します。酸性にして H⁺ を増やすと電離が左へ押し戻され、S²⁻ がごくわずかになります。そのため、**酸性では、とても溶けにくい硫化物だけが沈みます。**

:::table
caption: 硫化物の沈殿と液性
source: slides:無機の基本６「硫黄」s11「H₂S の反応②」の色一覧（ZnS 白・CdS 黄・SnS 褐・MnS 淡桃）と「イオン化傾向と沈殿しやすさの表」、muki:chemistry.js PRECIPITATES（CuS・PbS・Ag₂S・FeS）と教科書の硫化物イオンとの反応の表の事実
head:
- イオン化傾向
- 金属イオン
- 酸性で
- 中性・塩基性で
align: left | left | left | left
rows:
- 大（K〜Al） | Na⁺・Ca²⁺・Al³⁺ など | 沈殿しない | 沈殿しない
- 中（Zn〜Ni） | Zn²⁺・Fe²⁺・Mn²⁺ | 沈殿しない | ZnS（白）・FeS（黒）・MnS（淡赤）
- 小（Sn 以下） | Cu²⁺・Pb²⁺・Ag⁺・Cd²⁺・Sn²⁺ | CuS（黒）・PbS（黒）・Ag₂S（黒）・CdS（黄）・SnS（褐） | 沈殿する
:::

**硫化物は「黒が基本」で、例外の色（ZnS 白・CdS 黄・MnS 淡赤・SnS 褐）を覚えます。**そして「酸性でも沈むのは Sn 以下のイオン化傾向の小さい金属」「Zn・Fe は中性・塩基性でだけ沈む」の線引きを覚えてください。この線引きが、系統分離で硫化水素を2回に分けて通す理由になります。MnS の色は「淡赤色」と書くのがふつうですが、「淡桃色」と書く資料もあります。

:::reaction
left: Cu²⁺ ＋ S²⁻
right: CuS↓
level: ★★★
note: 黒色。酸性でも沈殿します。
:::

:::reaction
left: Pb²⁺ ＋ S²⁻
right: PbS↓
level: ★★★
note: 黒色。酢酸鉛(II) を染み込ませたろ紙が黒くなることで、H₂S の検出に使います。
:::

:::reaction
left: Zn²⁺ ＋ S²⁻
right: ZnS↓
level: ★★★
note: 白色。中性・塩基性でだけ沈殿します。硫化物で白いのは ZnS だけです。
:::

:::link
to: sulfur
text: 硫化水素の性質（酸・還元剤）のページへ
:::

:::link
to: cation-separation
text: 硫化水素を酸性と塩基性で2回通す、金属イオンの系統分離のページへ
:::

:::mistake
wrong: 硫化物はどれも黒色で、どの液性でも沈殿する
right: ZnS は**白**、CdS は**黄**。そして ZnS・FeS・MnS は**酸性では沈殿しません**（中性・塩基性でだけ沈む）。
why: 代表の CuS・PbS が黒で酸性でも沈むため、全部をその2つで覚えてしまうからです。★ 色は「黒が基本、例外は白・黄・淡桃・褐」、液性は「イオン化傾向で線を引く」と2つに分けて覚えましょう。
:::

## 例題 —— 硫化物イオン S²⁻ による沈殿

:::exercise
source: slides:無機の基本５「ハロゲン」s42-43「練習５」（Ag⁺＋Cl⁻・Pb²⁺＋2Cl⁻）と slides:無機の基本６ 練習４（2Ag⁺＋S²⁻）と同じ形の問い
prompt: 次の変化をイオン反応式で書け。**(1) 硝酸銀水溶液に塩化ナトリウム水溶液を加えると白色沈殿が生じた　(2) 硫酸銅(II) 水溶液に硫化水素を通じると黒色沈殿が生じた　(3) 硝酸銀水溶液に硫化ナトリウム水溶液を加えると黒色沈殿が生じた**
answer: (1) Ag⁺ ＋ Cl⁻ → AgCl　(2) Cu²⁺ ＋ S²⁻ → CuS　(3) 2Ag⁺ ＋ S²⁻ → Ag₂S
:::

:::exercise
source: 自作（硫化物の液性の線引き。教科書の硫化物イオンとの反応の表の事実を使う）
prompt: Cu²⁺ と Zn²⁺ を含む水溶液を酸性にして硫化水素を通じた。沈殿するのはどちらか。また、もう一方を沈殿させるにはどうすればよいか。
answer: 沈殿するのは Cu²⁺（CuS・黒）です。Zn²⁺ は、ろ液をアンモニア水などで中性〜塩基性にしてから硫化水素を通すと、ZnS（白）として沈殿します。
:::

:::section
anchor: range
title: 覚える範囲
lead: 陰イオンごとの沈む相手と色、硫化物の液性の線引き、が中心です。
:::

**次の4つは必ず覚えてください。**

:::list
items:
- Cl⁻ → Ag⁺・Pb²⁺（白）。PbCl₂ は熱水に溶ける
- SO₄²⁻ → Ca²⁺・Ba²⁺・Pb²⁺（白・強酸に溶けない）。CO₃²⁻ → Ca²⁺・Ba²⁺（白・強酸に溶ける）
- 水酸化物の色（Cu(OH)₂ 青白・Ag₂O 褐・Fe(OH)₂ 緑白・FeO(OH) 赤褐・ほかは白）
- 硫化物は黒が基本（ZnS 白・CdS 黄）。酸性でも沈むのは Cu・Pb・Ag など、ZnS・FeS は中性・塩基性でだけ
:::

クロム酸塩の色と、SnS・MnS の色は、余裕があれば覚えましょう。CaSO₄ がうすい溶液で沈殿しないことがある点は、覚えなくても構いません。
