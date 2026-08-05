# 一問一答が指したいもの × assembler の在庫

`qa/data/assembler_links.jsonl`（283項目の棚卸し）が指す**分子**と**反応**を、
assembler の在庫と突き合わせた結果。**生成物なので手で編集しない**
（`node qa/tools/audit_library.js --write` が作る）。

---

# 第1部: 分子

照合先は **`getCompoundLibrary()`（`stages.json` ＋ `compounds.json`）**。
`summonMolecule` はこの結合済みの集合を名前の完全一致で引くので、
**`compounds.json` だけを見ると stages にしか無いものが「無い」に誤って落ちる**。

- ライブラリの母集団: **947 種**（compounds 889 / stages 117。重複を除いた固有名）
- qa が指したい分子: **74 種**

| 分類 | 件数 | 意味 |
|---|--:|---|
| ① 完全一致 | 52 | 今すぐ `?summon=` で引ける |
| ② `〜（別名）` 型 | 11 | 別名に阻まれているだけ。**登録すると重複を作る** |
| ③ 修飾つきしか無い | 3 | どれを指すかは qa 側が決める |
| ④ 影も形も無い | 8 | **登録要望** |

> ②と③を④に混ぜて渡すと「あるのに登録してくれ」と言うことになる。
> 実際にエチレン・プロペン・アセチレンは `stages.json` にあり、**素の名前で引けないだけ**だった。

## ② `〜（別名）` 型 —— 別名で引けるようにすれば済む

**登録は不要。** `（…）` の中の別名を抱き込んだ表記に完全一致が阻まれているだけ。
qa 側は `gen_links.js` が機械で解決して繋いである（一意に決まるときだけ）。ID が入れば根本的に解決する。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| p-ジクロロベンゼン | `p-ジクロロベンゼン（パラジクロロベンゼン）`<br><sub>compounds</sub> | `org.aro.ortho-meta-para` |
| アセチレン | `アセチレン（エチン）`<br><sub>stages</sub> | `org.ali.alkyne-functional`<br>`org.ali.alkyne-shape`<br>`org.ali.alkyne-addition`<br>`org.ali.acetylene-h2o`<br>`org.ali.acetylene-hcl` |
| エチレン | `エチレン（エテン）`<br><sub>stages</sub> | `org.ali.alkene-functional`<br>`org.ali.alkene-shape`<br>`org.ali.alkene-h2`<br>`org.ali.alkene-hx`<br>`org.ali.unsatur-detection`<br>`org.ali.addition-polymer`<br>`org.alcohol.ethanol-prep`<br>`org.poly.monomer-polymer`<br>`org.poly.polyethylene` |
| グリシルグリシン | `グリシルグリシン（ジペプチド）`<br><sub>compounds</sub> | `org.bio.peptide-bond` |
| スクロース | `スクロース（ショ糖）`<br><sub>compounds</sub> | `org.bio.sucrose` |
| ステアリン酸ナトリウム | `ステアリン酸ナトリウム（セッケン）`<br><sub>compounds</sub> | `org.fat.soap-structure` |
| トリオレイン | `トリオレイン（油脂・オレイン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.hardening` |
| トリステアリン | `トリステアリン（油脂・ステアリン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.structure`<br>`org.fat.soap-prep` |
| プロペン | `プロペン（プロピレン）`<br><sub>stages</sub> | `org.ali.markovnikov` |
| マルトース | `マルトース（麦芽糖）`<br><sub>compounds</sub> | `org.bio.disaccharide-def`<br>`org.bio.maltose` |
| ラクトース | `ラクトース（乳糖）`<br><sub>compounds</sub> | `org.bio.lactose-cellobiose` |

## ③ 修飾つきしか無い —— どれを指すかは qa 側が決めた

**ライブラリへの追加は不要。** どの立体・どの状態を指したいかは項目ごとに違うので、
`gen_links.js` の手表で項目単位に振り分けてある（鎖状か環状かで見せたいものが違う）。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| α-グルコース | `D-グルコース（鎖状）`<br><sub>**stages と compounds の両方**</sub><br>`β-D-グルコース（β-D-グルコピラノース）`<br><sub>**stages と compounds の両方**</sub><br>`α-D-グルコース（α-D-グルコピラノース）`<br><sub>compounds</sub> | `org.bio.glucose-reducing` |
| 鎖状グルコース | `D-グルコース（鎖状）`<br><sub>**stages と compounds の両方**</sub><br>`β-D-グルコース（β-D-グルコピラノース）`<br><sub>**stages と compounds の両方**</sub><br>`α-D-グルコース（α-D-グルコピラノース）`<br><sub>compounds</sub> | `org.bio.glucose-structure`<br>`org.bio.glucose-ring` |
| 鎖状フルクトース | `D-フルクトース（鎖状）`<br><sub>compounds</sub> | `org.bio.fructose` |

## ④ 影も形も無い —— 登録要望

**指す知識項目の数がそのまま優先度**（多く指されている分子から埋めると効く）。

| 分子 | 指す項目数 | 単元 | 指す知識項目 |
|---|--:|---|---|
| **アルキルベンゼンスルホン酸ナトリウム** | 1 | fat | `org.fat.detergent`（Lv3） |
| **デオキシリボース** | 1 | bio | `org.bio.dna-rna`（Lv3） |
| **ナイロン66** | 1 | poly | `org.poly.polyamide-silk`（Lv3） |
| **ビニルアルコール** | 1 | aliphatic | `org.ali.keto-enol`（Lv3） |
| **ヘキサクロロシクロヘキサン** | 1 | aro | `org.aro.cl2-addition`（Lv3） |
| **ポリアセチレン** | 1 | poly | `org.poly.conducting`（Lv4） |
| **ポリビニルアルコール** | 1 | poly | `org.poly.vinylon-acetal`（Lv4） |
| **塩化ベンゼンジアゾニウム** | 1 | aroN | `org.aroN.diazonium-decomp`（Lv3） |

## ① 完全一致（52 種）

1,3-ブタジエン（1） / 2-ブタノール（2） / 2-プロパノール（2） / 2-メチル-2-プロパノール（1） / o-クレゾール（1） / ε-カプロラクタム（2） / アクリロニトリル（1） / アジピン酸（1） / アセトアルデヒド（5） / アセトン（3） / アゾベンゼン（1） / アニリン（2） / アラニン（2） / イソプレン（3） / エタノール（4） / エチルメチルエーテル（1） / エチレングリコール（1） / オレイン酸（1） / ギ酸（2） / クロロプレン（1） / グリセリン（1） / グルタミン酸（1） / サリチル酸（3） / シクロプロパン（1） / シクロヘキサン（2） / シス-2-ブテン（1） / シュウ酸（1） / ジエチルエーテル（1） / ジメチルエーテル（1） / スチレン（1） / ステアリン酸（1） / セロビオース（1） / テレフタル酸（3） / トルエン（1） / ナフタレン（1） / ニトログリセリン（1） / フェノール（4） / ベンジルアルコール（1） / ベンゼン（2） / ベンゼンスルホン酸（1） / マレイン酸（2） / メタクリル酸メチル（1） / メタノール（1） / メタン（1） / 乳酸（1） / 塩化ビニル（2） / 安息香酸（2） / 無水フタル酸（1） / 無水酢酸（1） / 酢酸（4） / 酢酸エチル（3） / 酢酸ビニル（2）

## 指す先に `formula` が無い

`ナフタレン` —— 分子式を読む処理を入れると `undefined` を踏む。qa の test.html が既知の集合として見ている。

## ライブラリ内の同名重複（ID を振るときに「どちらが正か」を決める必要がある）

`getCompoundLibrary()` は stages と compounds を並べるので、同名エントリが2つ立つ。
`find` は先頭に当たるので実害は出ていないが、ID 付与では通れない。

- `メタン`
- `シクロプロパン`
- `シクロヘキサン`
- `1-ブテン`
- `イソプレン`
- `1-プロパノール`
- `2-プロパノール`
- `エチレングリコール`
- `グリセリン`
- `ジメチルエーテル`
- `プロピオン酸`
- `シュウ酸`
- `乳酸`
- `無水酢酸`
- `酢酸エチル`
- `メチルアミン`
- `エチルアミン`
- `アセトアミド`
- `尿素`
- `クロロメタン`
- `ジクロロメタン`
- `クロロホルム`
- `四塩化炭素`
- `塩化ビニル`
- `ベンゼン`
- `スチレン`
- `ナフタレン`
- `クロロベンゼン`
- `テレフタル酸`
- `アセトアニリド`
- `ベンズアルデヒド`
- `アセトフェノン`
- `グリシン`
- `アラニン`
- `セリン`
- `システイン`
- `メチオニン`
- `バリン`
- `ロイシン`
- `リシン`
- `フェニルアラニン`
- `チロシン`
- `グルタミン酸`
- `アスパラギン酸`
- `D-グルコース（鎖状）`
- `β-D-グルコース（β-D-グルコピラノース）`
- `パルミチン酸`
- `ステアリン酸`
- `アクリロニトリル`
- `酢酸ビニル`
- `メタクリル酸メチル`
- `アジピン酸`
- `ヘキサメチレンジアミン`
- `ε-カプロラクタム`

---

# 第2部: 反応（試薬パレットの優先度の材料）

## いま指している試薬（reactor の31種のうち使われているもの）

| 試薬 id | 指す項目数 | 指す知識項目 |
|---|--:|---|
| `addition_polymerization` | 7 | `org.ali.addition-polymer` `org.poly.monomer-polymer` `org.poly.polyethylene` `org.poly.vinyl-monomers` `org.poly.pvac-pva` `org.poly.pmma-teflon` `org.poly.acrylic` |
| `dehydration_intra` | 4 | `org.ali.ethanol-dehydration` `org.alcohol.dehydration` `org.alcohol.zaitsev` `org.carbonyl.maleic-anhydride` |
| `diene_polymerization` | 4 | `org.poly.natural-rubber` `org.poly.rubber-cis-trans` `org.poly.butadiene-rubber` `org.poly.chloroprene-rubber` |
| `add_h2` | 3 | `org.ali.alkene-h2` `org.ali.alkyne-addition` `org.fat.hardening` |
| `add_hbr` | 3 | `org.ali.alkene-hx` `org.ali.markovnikov` `org.ali.acetylene-hcl` |
| `condensation_polymer_info` | 3 | `org.poly.addition-vs-condensation` `org.poly.pet` `org.poly.nylon66` |
| `br2_water` | 2 | `org.ali.unsatur-detection` `org.aro.substitution-first` |
| `add_water` | 2 | `org.ali.acetylene-h2o` `org.alcohol.ethanol-prep` |
| `oxidize_primary` | 2 | `org.alcohol.oxidation` `org.carbonyl.formaldehyde-prep` |
| `oxidize_aldehyde` | 2 | `org.alcohol.oxidation-reagent` `org.carbonyl.aldehyde-oxidation` |
| `iodoform` | 2 | `org.alcohol.iodoform` `org.carbonyl.iodoform-carbonyl` |
| `ag_ammonia` | 2 | `org.carbonyl.silver-mirror` `org.carbonyl.ketone-no-reduce` |
| `nahco3` | 2 | `org.carbonyl.vs-carbonic` `org.phenol.weaker-than-carbonic` |
| `esterification` | 2 | `org.carbonyl.esterification` `org.aroN.methyl-salicylate` |
| `saponification` | 2 | `org.carbonyl.saponification` `org.fat.soap-prep` |
| `fecl3` | 2 | `org.phenol.def` `org.phenol.fecl3` |
| `acetylation_anhydride` | 2 | `org.aroN.acetanilide` `org.aroN.aspirin` |
| `fehling` | 1 | `org.carbonyl.fehling` |
| `oxidize_secondary` | 1 | `org.carbonyl.acetone-prep` |
| `dehydration_inter` | 1 | `org.carbonyl.acid-anhydride` |
| `hydrolysis_anhydride` | 1 | `org.carbonyl.acetic-anhydride-props` |
| `hydrolysis_ester` | 1 | `org.carbonyl.ester-hydrolysis` |
| `aromatic_nitration` | 1 | `org.phenol.picric` |
| `cyclize_glucose_alpha` | 1 | `org.bio.glucose-ring` |
| `open_glucopyranose` | 1 | `org.bio.glucose-reducing` |
| `ninhydrin` | 1 | `org.bio.ninhydrin` |
| `vulcanization` | 1 | `org.poly.vulcanization` |

## いま指している機構（14件のうち使われているもの）

| 機構 id | 指す項目数 | 指す知識項目 |
|---|--:|---|
| `methane_chlorination` | 1 | `org.ali.alkane-chlorination` |
| `ethene_h2o` | 1 | `org.ali.alkene-h2o` |
| `ethene_br2` | 1 | `org.ali.alkene-br2` |
| `ethanol_oxidation` | 1 | `org.carbonyl.acetaldehyde-prep` |
| `esterification` | 1 | `org.carbonyl.ester-water-origin` |
| `benzene_chlorination` | 1 | `org.aro.halogenation` |
| `benzene_nitration` | 1 | `org.aro.nitration` |
| `benzene_sulfonation` | 1 | `org.aro.sulfonation` |
| `aniline_diazotization` | 1 | `org.aroN.diazotization` |
| `diazo_coupling` | 1 | `org.aroN.coupling` |

## ★反応が無くて `none` にした項目（27 件）

**これが試薬を足すときの需要**。収録されたら `none` から拾い直せる項目で、
`why` に「何が無いのか」が書いてある。単元と Lv を添えたので、
**どの反応を足すと何項目が繋がるか**が読める。

| 知識項目 | 単元 | Lv | 何が無いと書いてあるか |
|---|---|--:|---|
| `org.alcohol.methanol-prep` | alcohol | 3 | 一酸化炭素と水素からの合成は reactor の31種に無く、触媒や高圧といった工業的条件も assembler は表現しない |
| `org.alcohol.na` | alcohol | 2 | ナトリウムとの反応は reactor の31種に無い。加えて水素の発生（気体）も assembler が表現しないので、反応が起きたこと自体が見えない<br><sub>★見直し候補。ナトリウムとの反応は2項目（org.phenol.na-h2 と）から指されている</sub> |
| `org.ali.acetylene-benzene` | aliphatic | 2 | アセチレン3分子の三量化に対応する反応が reactor に無い。生成物のベンゼンの構造は org.aro.benzene-structure の担当 |
| `org.ali.acetylene-prep` | aliphatic | 2 | 炭化カルシウムと水の反応は無機の反応で reactor に無く、発生装置も assembler は扱わない |
| `org.ali.alkane-combustion` | aliphatic | 1 | 燃焼に対応する反応が reactor に無く、発熱量も assembler は表現しない |
| `org.ali.alkene-oxidation` | aliphatic | 3 | 二重結合の酸化開裂に対応する反応が reactor に無い（酸化剤[O]は1級・2級アルコールとアルデヒドにしか作用しない実装）<br><sub>構造決定と直結する項目なので、reactor に酸化開裂が入ったら reaction で拾い直す候補</sub> |
| `org.ali.methane-prep` | aliphatic | 2 | 酢酸ナトリウムと水酸化ナトリウムを加熱する脱炭酸は reactor に無く、加熱などの実験操作も assembler は扱わない |
| `org.ali.vinylchloride-prep` | aliphatic | 3 | エチレンへの塩素付加（reactor の付加は臭素のみ）と、熱分解による塩化水素の脱離が reactor に無いので、2段の工業経路をたどれない |
| `org.aroN.aniline-prep` | aroN | 2 | スズ（鉄）と塩酸による還元 −NO₂ → −NH₂ に対応する試薬が reactor の31種に無いので、原料から生成物への変化を実行できない<br><sub>原料と生成物の分子はそれぞれ org.aro.nitration・org.aroN.amino で見える</sub> |
| `org.bio.alcohol-fermentation` | bio | 2 | 酵素チマーゼによるアルコール発酵は reactor の31種に無く、C₆H₁₂O₆ → 2C₂H₅OH + 2CO₂ という量的な関係も分子を組んでは見えない |
| `org.bio.enzyme-examples` | bio | 3 | 酵素とその基質・生成物の対応という暗記事項で、酵素反応そのものが reactor に無い |
| `org.bio.invert-sugar` | bio | 3 | 二糖のグリコシド結合を切る加水分解が reactor に無く（あるのはエステルと酸無水物）、転化糖が還元性を示すことも色でしか確かめられない<br><sub>グリコシド結合の加水分解が reactor に入ったら見直す候補（org.bio.starch-hydrolysis も同じ）</sub> |
| `org.bio.nitrocellulose` | bio | 3 | ヒドロキシ基を硝酸エステル -O-NO₂ に変える反応が reactor に無く（aromatic_nitration は芳香環の置換）、セルロースの鎖も扱えない |
| `org.bio.starch-hydrolysis` | bio | 3 | 酵素によるグリコシド結合の段階的な加水分解が reactor に無く、デンプン・デキストリンのような多糖の鎖も扱えない |
| `org.carbonyl.acetone-dry-distill` | carbonyl | 3 | 乾留（空気を断って加熱）は reactor の31種に無い。原料の酢酸カルシウムがイオン結晶で、assembler の作図対象（分子の骨格）に載らない |
| `org.carbonyl.acidity` | carbonyl | 2 | 弱酸性という液性・電離の度合いは assembler が持たない量なので見せられない<br><sub>ただし塩になった姿は見せられる（assembler は塩を線1本の共有結合として書く流儀で、酢酸ナトリウムが登録済み）。酸塩基反応が reactor に入れば拾い直せる ★見直し候補</sub> |
| `org.carbonyl.salt-strong-acid` | carbonyl | 3 | カルボン酸の塩と強酸の反応（弱酸の遊離）に対応する試薬が reactor に無い<br><sub>★見直し候補。生成物側の酢酸ナトリウムはライブラリにあるので、反応を足すだけで繋がる見込み（assembler レーンの実データ調査）</sub> |
| `org.fat.drying-oil` | fat | 4 | 空気中の酸素による酸化重合で固まる反応は reactor に無く、塗料としての用途も assembler に無い |
| `org.phenol.bromination` | phenol | 3 | 臭素による芳香環の置換に対応する試薬が無い（aromatic_halogenation は Cl 限定、br2_water は非芳香族の不飽和結合だけを見る）。2,4,6- の置換位置も白色沈殿も表現できない<br><sub>むしろ フェノール＋br2_water を押すと「ベンゼン環は脱色しない」という miss 文が出て、実際には反応するフェノールでは誤った説明になる。assembler レーンに伝える価値がある</sub> |
| `org.phenol.cumene` | phenol | 3 | クメン法の工程（空気酸化→分解）は reactor に無く、クメンの分子だけ見せても原料から生成物までの流れは分からない |
| `org.phenol.na-h2` | phenol | 2 | 金属ナトリウムとの反応と水素の発生に対応する試薬が reactor の31種に無い<br><sub>★見直し候補。ナトリウムとの反応は2項目（org.alcohol.na と）から指されている</sub> |
| `org.phenol.naoh` | phenol | 2 | 中和して塩になる変化に対応する試薬が reactor の31種に無い（塩の形そのものはライブラリにある）<br><sub>★見直し候補。「ナトリウムフェノキシド（フェノールのナトリウム塩）」が登録済みなので、反応を足すだけで繋がる見込み</sub> |
| `org.phenol.phenoxide-co2` | phenol | 3 | 弱酸の遊離は水溶液中の酸塩基平衡の話で、reactor には酸塩基反応そのものが無い<br><sub>★見直し候補。ナトリウムフェノキシドと炭酸水素ナトリウムがどちらもライブラリ・検出瓶にあるので、酸塩基反応が入れば繋がる見込み</sub> |
| `org.poly.copolymer` | poly | 3 | 2種類の単量体を1本の鎖に組み込む共重合は reactor に無く、混合比で性質を調節できることも assembler では表現しない |
| `org.poly.phenol-resin` | poly | 3 | 付加と縮合をくり返す付加縮合は reactor に無く、ベンゼン環が -CH₂- で橋かけされた立体網目構造も1分子の作図では表せない |
| `org.poly.sbr-copolymer` | poly | 3 | 2種類の単量体をいっしょに重合させる共重合は reactor に無く、スチレン単位とブタジエン単位が1本の鎖に混ざった構造をつくれない<br><sub>単量体のスチレンは org.aro.styrene、ブタジエンの重合は org.poly.butadiene-rubber が担当</sub> |
| `org.poly.vinylon` | poly | 3 | けん化とアセタール化はどちらも高分子鎖に対する操作で reactor に無く、4段階の工程順そのものは分子を1つ出しても表せない<br><sub>1段目（酢酸ビニルの付加重合）は org.poly.pvac-pva、アセタール化の理由は org.poly.vinylon-acetal が担当</sub> |

