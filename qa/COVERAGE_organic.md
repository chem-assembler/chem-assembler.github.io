# 有機 網羅表（カバレッジ台帳）— ドラフト v0.1

出典: 自作スライド `動画スライド/有機の基本*`（著作権フリー・内容使用可）を土台に洗い出し。
天井（難関頻出の穴）は `総合的研究化学` の目次で後追い補完予定。
規約は [TAXONOMY.md](TAXONOMY.md)。**これは粒度校正用のドラフト**。確定後 `questions.json` へ落とす。

**凡例** — 難: 難易度(1基本/2標準/3発展)　既: 既存23項目のカバー(✓=有 / △=部分 / 空=新規)　飛: 🔧=assembler等への飛び道具候補

---

## unit: `org.ali` 脂肪族炭化水素

### 分類・一般式
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.class-hydrocarbon` | 1 | | | 炭化水素は炭素と水素のみからなる |
| `org.ali.class-aliphatic` | 1 | | | 脂肪族=ベンゼン環をもたない／芳香族=もつ |
| `org.ali.class-chain-ring` | 1 | | | 脂肪族は鎖式と環式に分かれる |
| `org.ali.class-saturated` | 1 | ✓ | | 飽和=不飽和結合なし／不飽和=二重・三重結合あり |
| `org.ali.formula-alkane` | 1 | ✓ | | アルカン CₙH₂ₙ₊₂ |
| `org.ali.formula-alkene` | 1 | ✓ | | アルケン CₙH₂ₙ |
| `org.ali.formula-alkyne` | 1 | ✓ | | アルキン CₙH₂ₙ₋₂ |
| `org.ali.formula-cycloalkane` | 1 | ✓ | | シクロアルカン CₙH₂ₙ |
| `org.ali.formula-cycloalkene` | 3 | | | シクロアルケン CₙH₂ₙ₋₂ |
| `org.ali.homolog` | 2 | | | 同族体＝同じ一般式のグループ・似た性質 |
| `org.ali.unsaturation` | 2 | | 🔧 | 基準から二重で−2・三重で−4・環で−2 水素が減る |
| `org.ali.suffix` | 2 | | | 語尾 -ene/-yne・語頭 cyclo- |

### アルカン
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.alkane-shape` | 1 | ✓ | 🔧 | メタンは正四面体形・結合角約109.5° |
| `org.ali.alkane-rotation` | 2 | | | 単結合は自由に回転できる |
| `org.ali.alkane-substitution` | 1 | ✓ | | アルカンの主な反応は置換反応 |
| `org.ali.alkane-chlorination` | 2 | ✓ | | メタン＋塩素（光）→ クロロメタン＋塩化水素 |
| `org.ali.alkane-polychloro` | 2 | △ | | 置換が進み CH₂Cl₂・CHCl₃・CCl₄ |
| `org.ali.alkane-names` | 1 | | | メタン〜デカンの名称（接頭辞＋-ane） |
| `org.ali.alkane-bp` | 2 | ✓ | | 分子量が大きいほど沸点が高い |
| `org.ali.alkane-state` | 1 | ✓ | | C4まで気体・C5以上液体（C18以上固体） |
| `org.ali.alkane-solubility` | 1 | ✓ | | 無極性で水に溶けにくい |
| `org.ali.methane-prep` | 2 | | | メタン製法＝酢酸ナトリウム＋NaOH を加熱 |
| `org.ali.methane-collect` | 1 | | | メタンは無色無臭・水上置換で捕集 |

### シクロアルカン
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.cyclo-props` | 2 | | | 大きい環はアルカンとほぼ同じ性質 |
| `org.ali.cyclo-strain` | 3 | | | 三・四員環はひずみで不安定・反応しやすく開環 |

### アルケン
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.alkene-functional` | 1 | ✓ | | 官能基は炭素間二重結合 C=C |
| `org.ali.alkene-shape` | 2 | ✓ | 🔧 | 二重結合まわり6原子は同一平面・約120° |
| `org.ali.alkene-bondlength` | 3 | | | 結合長：単結合＞二重結合＞三重結合 |
| `org.ali.alkene-addition` | 1 | ✓ | | 主な反応は付加反応 |
| `org.ali.alkene-H2` | 2 | ✓ | | H₂付加（Pt/Ni触媒）→ アルカン |
| `org.ali.alkene-H2O` | 2 | ✓ | | H₂O付加 → アルコール |
| `org.ali.alkene-HX` | 2 | | | H–X（ハロゲン化水素等）の付加 |
| `org.ali.alkene-Br2` | 2 | ✓ | | Br₂付加 → ジブロモ体・臭素水を脱色 |
| `org.ali.markovnikov` | 3 | | | マルコフニコフ則（Hは水素が多い炭素へ） |
| `org.ali.alkene-oxidation` | 3 | | | 酸化開裂：オゾン→アルデヒド/ケトン、KMnO₄→カルボン酸/ケトン |
| `org.ali.unsatur-detection` | 2 | △ | | 不飽和検出＝臭素水/KMnO₄の脱色 |
| `org.ali.addition-polymer` | 2 | ✓ | 🔧 | 付加重合 → ポリエチレン等 |
| `org.ali.vinyl-group` | 2 | | | ビニル基・ビニル化合物は付加重合の単量体 |
| `org.ali.ethylene-prep` | 2 | △ | | 工業＝ナフサ熱分解／実験＝エタノール脱水 |
| `org.ali.ethanol-dehydration` | 3 | ✓ | | 160–170℃分子内→エチレン、130–140℃分子間→エーテル |
| `org.ali.vinylchloride-prep` | 3 | | | 1,2-ジクロロエタンの熱分解 → 塩化ビニル |

### アルキン
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.alkyne-functional` | 1 | ✓ | | 官能基は炭素間三重結合 C≡C |
| `org.ali.alkyne-shape` | 2 | ✓ | 🔧 | アセチレンは直線形・約180° |
| `org.ali.alkyne-addition` | 2 | | | 三重結合は2段階で付加 |
| `org.ali.acetylene-prep` | 2 | ✓ | | CaC₂＋水 → アセチレン＋Ca(OH)₂ |
| `org.ali.acetylene-flame` | 2 | △ | | 酸素アセチレン炎（約3000℃）で溶接・切断 |
| `org.ali.acetylene-H2O` | 3 | ✓ | | 水付加 →（ビニルアルコール）→ アセトアルデヒド |
| `org.ali.keto-enol` | 3 | | | エノール型は不安定でケト型になる |
| `org.ali.acetylene-HCl` | 3 | ✓ | | HCl付加 → 塩化ビニル |
| `org.ali.acetylene-benzene` | 3 | ✓ | | 3分子重合 → ベンゼン |
| `org.ali.silver-acetylide` | 3 | | | アンモニア性硝酸銀 → 銀アセチリド（白沈） |

### 異性体・命名（脂肪族に現れる事実。書き出し手続きは 🔧 assembler）
| コード | 難 | 既 | 飛 | 知識 |
|---|:--:|:--:|:--:|---|
| `org.ali.iso-c4h10` | 2 | ✓ | 🔧 | C₄H₁₀ の構造異性体は2種類 |
| `org.ali.iso-c5h12` | 2 | ✓ | 🔧 | C₅H₁₂ の構造異性体は3種類 |
| `org.ali.iso-butene` | 3 | △ | 🔧 | ブテンの構造異性体3種・立体含め4種 |
| `org.ali.name-mainchain` | 2 | | | 命名は最長の主鎖を基準に置換基を逆から読む |
| `org.ali.name-numbering` | 2 | | | 番号は名称の数字が最小になるよう振る |
| `org.ali.name-alkene-pos` | 2 | | | -ene/-yne は二重・三重結合の位置番号を優先 |

---

## 隣接ユニット（スライドが既にある＝次の候補）

| unit | 内容（スライド） | 概算項目数 |
|---|---|:--:|
| `org.iso` | 異性体総論：構造/立体、シス-トランス、鏡像異性体・不斉炭素（枝の付け根）、メソ体、RS表示（1-2, 2-12） | 10–14 |
| `org.anal` | 元素の確認（C/H/N/Cl/S 定性）・元素分析（燃焼装置・順番・組成式→分子式・比例式）（1-3, 1-4） | 10–12 |
| `org.alcohol` | アルコール（級・価数・沸点・Na・脱水/ザイツェフ・酸化・ヨードホルム・製法）／エーテル（3-1, 3-2） | 18–24 |

---

## 校正してほしい点

1. **粒度**：上の `org.ali` は約55項目。この細かさでよい？（例:「付加生成物」を1項目にまとめるか、H₂/H₂O/Br₂/HX を別項目にするか）
2. **範囲フラグ**：Lv3 のうち難関特化（マルコフニコフ・ザイツェフ・オゾン分解・銀アセチリド）はこのまま標準内でよい？ `beyond` にすべきものは？
3. **書き出し／構造決定**：手続きは assembler へ飛ばし、一問一答は「異性体数・不斉炭素の有無・命名ルール」等の事実に限定、で合意？
