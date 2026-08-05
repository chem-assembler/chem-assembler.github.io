# 一問一答が指したい分子 × assembler ライブラリの照合

`qa/data/assembler_links.jsonl` の `summon` / `reaction` が指す分子を、
assembler の **`getCompoundLibrary()`（`stages.json` ＋ `compounds.json`）** と突き合わせた結果。
**生成物なので手で編集しない**（`scratchpad/inv/merge_inv.js` が作る）。

- ライブラリの母集団: **626 種**（compounds 568 / stages 117。重複を除いた固有名）
- qa が指したい分子: **74 種**

| 分類 | 件数 | 意味 |
|---|--:|---|
| ① 完全一致 | 52 | 今すぐ `?summon=` で引ける |
| ② `〜（別名）` 型 | 11 | 別名に阻まれているだけ。**登録すると重複を作る** |
| ③ 修飾つきしか無い | 3 | 素のものが要るか要判断 |
| ④ 影も形も無い | 8 | **登録要望** |

> ②と③を④に混ぜて渡すと「あるのに登録してくれ」と言うことになる。
> 実際にエチレン・プロペン・アセチレンは `stages.json` にあり、**素の名前で引けないだけ**だった。

## ② `〜（別名）` 型 —— 別名で引けるようにすれば済む

**登録は不要。** `（…）` の中の別名を抱き込んだ表記に完全一致が阻まれているだけ。
素の名前を別名として引けるようにするか、ID を振れば解決する。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| p-ジクロロベンゼン | `p-ジクロロベンゼン（パラジクロロベンゼン）`<br><sub>compounds</sub> | `org.aro.ortho-meta-para` |
| アセチレン | `アセチレン（エチン）`<br><sub>stages</sub> | `org.ali.alkyne-functional`<br>`org.ali.alkyne-shape`<br>`org.ali.alkyne-addition`<br>`org.ali.acetylene-h2o`<br>`org.ali.acetylene-hcl` |
| エチレン | `エチレン（エテン）`<br><sub>stages</sub> | `org.ali.alkene-functional`<br>`org.ali.alkene-shape`<br>`org.ali.alkene-h2`<br>`org.ali.alkene-hx`<br>`org.ali.addition-polymer`<br>`org.alcohol.ethanol-prep`<br>`org.poly.monomer-polymer`<br>`org.poly.polyethylene` |
| グリシルグリシン | `グリシルグリシン（ジペプチド）`<br><sub>compounds</sub> | `org.bio.peptide-bond` |
| スクロース | `スクロース（ショ糖）`<br><sub>compounds</sub> | `org.bio.sucrose` |
| ステアリン酸ナトリウム | `ステアリン酸ナトリウム（セッケン）`<br><sub>compounds</sub> | `org.fat.soap-structure` |
| トリオレイン | `トリオレイン（油脂・オレイン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.hardening` |
| トリステアリン | `トリステアリン（油脂・ステアリン酸のグリセリド）`<br><sub>compounds</sub> | `org.fat.structure`<br>`org.fat.soap-prep` |
| プロペン | `プロペン（プロピレン）`<br><sub>stages</sub> | `org.ali.markovnikov` |
| マルトース | `マルトース（麦芽糖）`<br><sub>compounds</sub> | `org.bio.disaccharide-def`<br>`org.bio.maltose` |
| ラクトース | `ラクトース（乳糖）`<br><sub>compounds</sub> | `org.bio.lactose-cellobiose` |

## ③ 修飾つきしか無い —— 素のものを登録するか判断が要る

どれを指したいのかは **qa 側が決める**（鎖状か環状か・D か L かで見せたいものが違う）。ライブラリに追加は不要な見込み。

| 指したい分子 | ライブラリの実体 | 指す知識項目 |
|---|---|---|
| α-グルコース | `D-グルコース（鎖状）`<br><sub>stages+compounds</sub><br>`β-D-グルコース（β-D-グルコピラノース）`<br><sub>stages+compounds</sub><br>`α-D-グルコース（α-D-グルコピラノース）`<br><sub>compounds</sub> | `org.bio.glucose-reducing` |
| 鎖状グルコース | `D-グルコース（鎖状）`<br><sub>stages+compounds</sub><br>`β-D-グルコース（β-D-グルコピラノース）`<br><sub>stages+compounds</sub><br>`α-D-グルコース（α-D-グルコピラノース）`<br><sub>compounds</sub> | `org.bio.glucose-structure`<br>`org.bio.glucose-ring` |
| 鎖状フルクトース | `D-フルクトース（鎖状）`<br><sub>compounds</sub> | `org.bio.fructose` |

## ④ 影も形も無い —— 登録要望

**指す知識項目の数がそのまま優先度**（多く指されている分子から埋めると効く）。

| 分子 | 指す項目数 | 指す知識項目 |
|---|--:|---|
| **アルキルベンゼンスルホン酸ナトリウム** | 1 | `org.fat.detergent` |
| **デオキシリボース** | 1 | `org.bio.dna-rna` |
| **ナイロン66** | 1 | `org.poly.polyamide-silk` |
| **ビニルアルコール** | 1 | `org.ali.keto-enol` |
| **ヘキサクロロシクロヘキサン** | 1 | `org.aro.cl2-addition` |
| **ポリアセチレン** | 1 | `org.poly.conducting` |
| **ポリビニルアルコール** | 1 | `org.poly.vinylon-acetal` |
| **塩化ベンゼンジアゾニウム** | 1 | `org.aroN.diazonium-decomp` |

## ① 完全一致（52 種）

1,3-ブタジエン（1） / 2-ブタノール（2） / 2-プロパノール（2） / 2-メチル-2-プロパノール（1） / o-クレゾール（1） / ε-カプロラクタム（2） / アクリロニトリル（1） / アジピン酸（1） / アセトアルデヒド（3） / アセトン（3） / アゾベンゼン（1） / アニリン（2） / アラニン（1） / イソプレン（3） / エタノール（4） / エチルメチルエーテル（1） / エチレングリコール（1） / オレイン酸（1） / ギ酸（2） / クロロプレン（1） / グリセリン（1） / グルタミン酸（1） / サリチル酸（3） / シクロプロパン（1） / シクロヘキサン（2） / シス-2-ブテン（1） / シュウ酸（1） / ジエチルエーテル（1） / ジメチルエーテル（1） / スチレン（1） / ステアリン酸（1） / セロビオース（1） / テレフタル酸（3） / トルエン（1） / ナフタレン（1） / ニトログリセリン（1） / フェノール（2） / ベンジルアルコール（1） / ベンゼン（2） / ベンゼンスルホン酸（1） / マレイン酸（2） / メタクリル酸メチル（1） / メタノール（1） / メタン（1） / 乳酸（1） / 塩化ビニル（2） / 安息香酸（2） / 無水フタル酸（1） / 無水酢酸（1） / 酢酸（3） / 酢酸エチル（3） / 酢酸ビニル（2）

## 指す先に `formula` が無い

`ナフタレン` —— 分子式を読む処理を入れると `undefined` を踏む。qa の `runLinkTargetTests` が鳴らしている。

