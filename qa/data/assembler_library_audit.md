# 一問一答が指したいもの × assembler の在庫

`qa/data/assembler_links.jsonl`（283項目の棚卸し）が指す**分子**と**反応**を、
assembler の在庫と突き合わせた結果。**生成物なので手で編集しない**
（`node qa/tools/audit_library.js --write` が作る）。

---

# 第1部: 分子

照合先は **`getCompoundLibrary()`（`stages.json` ＋ `compounds.json`）**。
`summonMolecule` はこの結合済みの集合を名前の完全一致で引くので、
**`compounds.json` だけを見ると stages にしか無いものが「無い」に誤って落ちる**。

- ライブラリの母集団: **1111 種**（compounds 1051 / stages 120。重複を除いた固有名）
- qa が指したい分子: **82 種**

| 分類 | 件数 | 意味 |
|---|--:|---|
| ① 完全一致 | 66 | 今すぐ `?summon=` で引ける |
| ② `〜（別名）` 型 | 13 | 別名に阻まれているだけ。**登録すると重複を作る** |
| ③ 修飾つきしか無い | 3 | どれを指すかは qa 側が決める |
| ④ 影も形も無い | 0 | **登録要望** |

> ②と③を④に混ぜて渡すと「あるのに登録してくれ」と言うことになる。
> 実際にエチレン・プロペン・アセチレンは `stages.json` にあり、**素の名前で引けないだけ**だった。

## ② `〜（別名）` 型 —— 別名で引けるようにすれば済む

**登録は不要。** `（…）` の中の別名を抱き込んだ表記に完全一致が阻まれているだけ。
qa 側は `gen_links.js` が機械で解決して繋いである（一意に決まるときだけ）。ID が入れば根本的に解決する。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| p-ジクロロベンゼン | `p-ジクロロベンゼン（パラジクロロベンゼン）`<br><sub>compounds</sub> | `org.aro.ortho-meta-para` |
| アセチレン | `アセチレン（エチン）`<br><sub>stages</sub> | `org.ali.alkyne-functional`<br>`org.ali.alkyne-shape`<br>`org.ali.alkyne-addition`<br>`org.ali.acetylene-h2o`<br>`org.ali.acetylene-hcl`<br>`org.ali.acetylene-benzene` |
| アニソール | `アニソール（メトキシベンゼン）`<br><sub>compounds</sub> | `org.phenol.methyl-ether` |
| エチレン | `エチレン（エテン）`<br><sub>stages</sub> | `org.ali.alkene-functional`<br>`org.ali.alkene-shape`<br>`org.ali.alkene-h2`<br>`org.ali.alkene-hx`<br>`org.ali.unsatur-detection`<br>`org.ali.addition-polymer`<br>`org.alcohol.ethanol-prep`<br>`org.poly.monomer-polymer`<br>`org.poly.polyethylene` |
| グリシルグリシン | `グリシルグリシン（ジペプチド）`<br><sub>compounds</sub> | `org.bio.peptide-bond` |
| スクロース | `スクロース（ショ糖）`<br><sub>compounds</sub> | `org.bio.sucrose`<br>`org.bio.glycoside` |
| ステアリン酸ナトリウム | `ステアリン酸ナトリウム（セッケン）`<br><sub>compounds</sub> | `org.fat.soap-structure` |
| トリオレイン | `トリオレイン（油脂・オレイン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.hardening` |
| トリステアリン | `トリステアリン（油脂・ステアリン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.structure`<br>`org.fat.soap-prep` |
| プロペン | `プロペン（プロピレン）`<br><sub>stages</sub> | `org.ali.markovnikov` |
| マルトース | `マルトース（麦芽糖）`<br><sub>compounds</sub> | `org.bio.disaccharide-def`<br>`org.bio.maltose` |
| メシチレン | `メシチレン（1,3,5-トリメチルベンゼン）`<br><sub>compounds</sub> | `org.anal.equivalent-h` |
| ラクトース | `ラクトース（乳糖）`<br><sub>compounds</sub> | `org.bio.lactose-cellobiose` |

## ③ 修飾つきしか無い —— どれを指すかは qa 側が決めた

**ライブラリへの追加は不要。** どの立体・どの状態を指したいかは項目ごとに違うので、
`gen_links.js` の手表で項目単位に振り分けてある（鎖状か環状かで見せたいものが違う）。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| α-グルコース | `D-グルコース（鎖状）`<br><sub>**stages と compounds の両方**</sub><br>`β-D-グルコース`<br><sub>**stages と compounds の両方**</sub><br>`α-D-グルコース`<br><sub>compounds</sub> | `org.bio.glucose-reducing` |
| 鎖状グルコース | `D-グルコース（鎖状）`<br><sub>**stages と compounds の両方**</sub><br>`β-D-グルコース`<br><sub>**stages と compounds の両方**</sub><br>`α-D-グルコース`<br><sub>compounds</sub> | `org.bio.glucose-structure`<br>`org.bio.glucose-ring` |
| 鎖状フルクトース | `D-フルクトース（鎖状）`<br><sub>compounds</sub> | `org.bio.fructose` |

## ① 完全一致（66 種）

1,3-ブタジエン（1） / 2-ブタノール（3） / 2-プロパノール（3） / 2-メチル-2-プロパノール（1） / o-クレゾール（1） / o-ニトロフェノール（1） / ε-カプロラクタム（2） / アクリロニトリル（1） / アジピン酸（1） / アセトアルデヒド（5） / アセトン（3） / アゾベンゼン（1） / アニリン（3） / アラニン（2） / アルキルベンゼンスルホン酸ナトリウム（1） / イソプレン（3） / エタノール（5） / エチルメチルエーテル（1） / エチレングリコール（1） / オレイン酸（1） / ギ酸（2） / ギ酸メチル（1） / クロロプレン（1） / グリセリン（1） / グルタミン酸（1） / サリチル酸（3） / シクロプロパン（1） / シクロヘキサン（2） / シス-2-ブテン（2） / シュウ酸（1） / ジエチルエーテル（2） / ジメチルエーテル（1） / スチレン（3） / ステアリン酸（1） / セロビオース（1） / テレフタル酸（3） / デオキシリボース（1） / トルエン（2） / ナイロン66（1） / ナトリウムフェノキシド（フェノールのナトリウム塩）（1） / ナフタレン（2） / ニトログリセリン（1） / ニトロベンゼン（1） / ビニルアルコール（1） / フェノール（6） / ヘキサクロロシクロヘキサン（1） / ベンジルアルコール（1） / ベンゼン（2） / ベンゼンスルホン酸（1） / ホルムアルデヒド（1） / ポリアセチレン（1） / ポリビニルアルコール（1） / マレイン酸（3） / メタクリル酸メチル（1） / メタノール（1） / メタン（2） / リシン（1） / 乳酸（1） / 塩化ビニル（2） / 安息香酸（2） / 無水フタル酸（1） / 無水酢酸（1） / 酢酸（6） / 酢酸エチル（4） / 酢酸ナトリウム（1） / 酢酸ビニル（2）

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
- `β-D-グルコース`
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
| `sodium_metal` | 2 | `org.alcohol.na` `org.phenol.na-h2` |
| `oxidize_primary` | 2 | `org.alcohol.oxidation` `org.carbonyl.formaldehyde-prep` |
| `oxidize_aldehyde` | 2 | `org.alcohol.oxidation-reagent` `org.carbonyl.aldehyde-oxidation` |
| `iodoform` | 2 | `org.alcohol.iodoform` `org.carbonyl.iodoform-carbonyl` |
| `ag_ammonia` | 2 | `org.carbonyl.silver-mirror` `org.carbonyl.ketone-no-reduce` |
| `naoh_aq` | 2 | `org.carbonyl.acidity` `org.phenol.naoh` |
| `nahco3` | 2 | `org.carbonyl.vs-carbonic` `org.phenol.weaker-than-carbonic` |
| `h2so4_dil` | 2 | `org.carbonyl.salt-strong-acid` `org.bio.glycoside` |
| `esterification` | 2 | `org.carbonyl.esterification` `org.aroN.methyl-salicylate` |
| `saponification` | 2 | `org.carbonyl.saponification` `org.fat.soap-prep` |
| `fecl3` | 2 | `org.phenol.def` `org.phenol.fecl3` |
| `acetylation_anhydride` | 2 | `org.aroN.acetanilide` `org.aroN.aspirin` |
| `copolymerization` | 2 | `org.poly.copolymer` `org.poly.sbr-copolymer` |
| `combustion` | 1 | `org.ali.alkane-combustion` |
| `alkyne_trimerization` | 1 | `org.ali.acetylene-benzene` |
| `fehling` | 1 | `org.carbonyl.fehling` |
| `oxidize_secondary` | 1 | `org.carbonyl.acetone-prep` |
| `dehydration_inter` | 1 | `org.carbonyl.acid-anhydride` |
| `hydrolysis_anhydride` | 1 | `org.carbonyl.acetic-anhydride-props` |
| `hydrolysis_ester` | 1 | `org.carbonyl.ester-hydrolysis` |
| `co2` | 1 | `org.phenol.phenoxide-co2` |
| `aromatic_nitration` | 1 | `org.phenol.picric` |
| `cyclize_glucose_alpha` | 1 | `org.bio.glucose-ring` |
| `open_glucopyranose` | 1 | `org.bio.glucose-reducing` |
| `ninhydrin` | 1 | `org.bio.ninhydrin` |
| `vulcanization` | 1 | `org.poly.vulcanization` |
| `oxidative_cleavage` | 1 | `org.ali.ozonolysis-reconstruct` |
| `mixed_acid` | 1 | `org.aro.orientation` |

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

## ★反応が無くて `none` にした項目（18 件）

**これが試薬を足すときの需要**。収録されたら `none` から拾い直せる項目で、
`why` に「何が無いのか」が書いてある。単元と Lv を添えたので、
**どの反応を足すと何項目が繋がるか**が読める。

| 知識項目 | 単元 | Lv | 何が無いと書いてあるか |
|---|---|--:|---|
| `org.alcohol.methanol-prep` | alcohol | 1 | 一酸化炭素と水素からの合成は reactor の反応ルールに無く、触媒や高圧といった工業的条件も assembler は表現しない |
| `org.ali.acetylene-prep` | aliphatic | 2 | 炭化カルシウムと水の反応は無機の反応で reactor に無く、発生装置も assembler は扱わない |
| `org.ali.alkene-oxidation` | aliphatic | 3 | 二重結合の酸化開裂に対応する反応が reactor に無い（酸化剤[O]は1級・2級アルコールとアルデヒドにしか作用しない実装）<br><sub>構造決定と直結する項目なので、reactor に酸化開裂が入ったら reaction で拾い直す候補</sub> |
| `org.ali.methane-prep` | aliphatic | 2 | 酢酸ナトリウムと水酸化ナトリウムを加熱する脱炭酸は reactor に無く、加熱などの実験操作も assembler は扱わない |
| `org.ali.vinylchloride-prep` | aliphatic | 2 | エチレンへの塩素付加（reactor の付加は臭素のみ）と、熱分解による塩化水素の脱離が reactor に無いので、2段の工業経路をたどれない |
| `org.aroN.aniline-prep` | aroN | 2 | スズ（鉄）と塩酸による還元 −NO₂ → −NH₂ に対応する試薬が reactor の反応ルールに無いので、原料から生成物への変化を実行できない<br><sub>原料と生成物の分子はそれぞれ org.aro.nitration・org.aroN.amino で見える</sub> |
| `org.bio.alcohol-fermentation` | bio | 2 | 酵素チマーゼによるアルコール発酵は reactor の反応ルールに無く、C₆H₁₂O₆ → 2C₂H₅OH + 2CO₂ という量的な関係も分子を組んでは見えない |
| `org.bio.enzyme-examples` | bio | 2 | 酵素とその基質・生成物の対応という暗記事項で、酵素反応そのものが reactor に無い |
| `org.bio.invert-sugar` | bio | 1 | 二糖のグリコシド結合を切る加水分解が reactor に無く（あるのはエステルと酸無水物）、転化糖が還元性を示すことも色でしか確かめられない<br><sub>グリコシド結合の加水分解が reactor に入ったら見直す候補（org.bio.starch-hydrolysis も同じ）</sub> |
| `org.bio.nitrocellulose` | bio | 2 | ヒドロキシ基を硝酸エステル -O-NO₂ に変える反応が reactor に無く（aromatic_nitration は芳香環の置換）、セルロースの鎖も扱えない |
| `org.bio.starch-hydrolysis` | bio | 2 | 酵素によるグリコシド結合の段階的な加水分解が reactor に無く、デンプン・デキストリンのような多糖の鎖も扱えない |
| `org.carbonyl.acetone-dry-distill` | carbonyl | 2 | 乾留（空気を断って加熱）は reactor の反応ルールに無い。原料の酢酸カルシウムがイオン結晶で、assembler の作図対象（分子の骨格）に載らない |
| `org.carbonyl.lactone` | carbonyl | 2 | 同一分子内での脱水（分子内エステル化）に対応する試薬が reactor に無い<br><sub>★見直し候補。2026-08-08 追加（入試解析レーンの発注）。分子内エステル化の反応が入れば繋がる。生成物側の環状エステルはライブラリを確認していないので、そのときに一緒に見る</sub> |
| `org.fat.drying-oil` | fat | 2 | 空気中の酸素による酸化重合で固まる反応は reactor に無く、塗料としての用途も assembler に無い |
| `org.phenol.bromination` | phenol | 2 | 臭素による芳香環の置換に対応する試薬が無い（aromatic_halogenation は Cl 限定、br2_water は非芳香族の不飽和結合だけを見る）。2,4,6- の置換位置も白色沈殿も表現できない<br><sub>むしろ フェノール＋br2_water を押すと「ベンゼン環は脱色しない」という miss 文が出て、実際には反応するフェノールでは誤った説明になる。assembler レーンに伝える価値がある</sub> |
| `org.phenol.cumene` | phenol | 2 | クメン法の工程（空気酸化→分解）は reactor に無く、クメンの分子だけ見せても原料から生成物までの流れは分からない |
| `org.poly.phenol-resin` | poly | 1 | 付加と縮合をくり返す付加縮合は reactor に無く、ベンゼン環が -CH₂- で橋かけされた立体網目構造も1分子の作図では表せない |
| `org.poly.vinylon` | poly | 1 | けん化とアセタール化はどちらも高分子鎖に対する操作で reactor に無く、4段階の工程順そのものは分子を1つ出しても表せない<br><sub>1段目（酢酸ビニルの付加重合）は org.poly.pvac-pva、アセタール化の理由は org.poly.vinylon-acetal が担当</sub> |

