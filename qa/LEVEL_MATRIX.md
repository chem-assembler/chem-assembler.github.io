# Lv の根拠の表（マトリックス）

一問一答の全項目について、**Lv（difficulty）を決める材料と、決まった値**を1行ずつ並べたもの。
Lv の基準は [DESIGN_difficulty_frequency.md](DESIGN_difficulty_frequency.md) の §3-2（セミナーの片側の論法）と §7-2（教科書 × セミナーの表）。

⚠ **このファイルは `qa/tools/gen_level_matrix.js` が生成する。** 手で直さない。
正は `qa/data/level_matrix.jsonl`（1行1項目）。**手で書くのはその `override` 欄だけ**で、ほかの欄は `questions.json` とセミナーの材料から作り直す。
ずれると回帰テスト（qa/test.html「Lv の根拠の表」）が鳴る。

★ **上書きのある項目は、Lv を書き換える道具（`apply_seminar_levels.js`・`build_evidence.js`）が動かさない。**
★ **機械の目安と食い違う Lv には、必ず上書きの記録を付ける**（無いとテストが鳴る ＝ 根拠の無い手直しを残さない）。

## 欄の読み方

| 欄 | 意味 |
|---|---|
| 現在 | `questions.json` の `difficulty` |
| 教科書 | 本文 / 発展欄 / 見あたらない。（弱）は一致が短く、§7-2 の表を使わずセミナー側だけで挟む |
| セミナー | プロセス / 基本 / 発展 / 未登場。「プロセス＋発展」はプロセスに出るうえ、問題では発展にだけ出る |
| 入試 | ① 解答になった回数（未 ＝ 判定していない）／② 手筋として使われた問題数 |
| 目安 §3-2 | `apply_seminar_levels.js` の規則が出す値（基本に出て Lv3以上 → 2／発展にだけ出て Lv2以下 → 3／ほかは動かさない） |
| 目安 §7-2 | `build_evidence.js` の許容区間（教科書 × セミナー）。いまの Lv が区間の外なら ⚠ と行き先 |
| 上書き | ユーザーが決めた値（元→上書き・日付）。理由は上の節 |
| 最終 | 上書きがあればその値、無ければ現在の値。**現在と必ず一致する** |

## ユーザーの上書き（2件）

| コード | 元 | 上書き | 日付 | 理由 | 記録 | 目安 §3-2 | 目安 §7-2 |
|---|--:|--:|---|---|---|--:|---|
| `org.aro.naphthalene-oxidation` | 4 | **3** | 2026-09-15 | ユーザー判断 2026-09-15（Lv2か3） | v112（62c47ee7） | 3 | 3〜4 |
| `org.phenol.picric` | 3 | **2** | 2026-09-15 | ユーザー判断 2026-09-15（Lv2かも） | v112（62c47ee7）・2026-09-17 承認 | **3** ⚠ | **3** ⚠ |

## 機械の目安と食い違う項目（上書きの記録なし・0件）

なし。機械の目安と食い違う Lv は、すべて上の上書きに記録がある。

## 全項目（317件）

Lv の分布: Lv1 103件・Lv2 174件・Lv3 30件・Lv4 10件

### aliphatic（脂肪族炭化水素・72件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.ali.class-hydrocarbon` | 分類・一般式 | 1 | 本文（弱） | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.ali.class-aliphatic` | 分類・一般式 | 1 | 本文（弱） | 未登場 | ①未 ②0 | 1 | 1〜4 |  | 1 |
| `org.ali.class-chain-ring` | 分類・一般式 | 1 | 本文 | 未登場 | ①0 ②44 | 1 | 1〜2 |  | 1 |
| `org.ali.class-saturated` | 分類・一般式 | 1 | 本文 | プロセス | ①0 ②43 | 1 | 1 |  | 1 |
| `org.ali.formula-alkane` | 分類・一般式 | 1 | 本文 | プロセス＋基本 | ①0 ②43 | 1 | 1 |  | 1 |
| `org.ali.formula-alkene` | 分類・一般式 | 1 | 本文（弱） | プロセス＋基本 | ①0 ②44 | 1 | 1 |  | 1 |
| `org.ali.formula-alkyne` | 分類・一般式 | 1 | 本文 | プロセス＋基本 | ①0 ②43 | 1 | 1 |  | 1 |
| `org.ali.formula-cycloalkane` | 分類・一般式 | 1 | 本文 | プロセス＋基本 | ①0 ②43 | 1 | 1 |  | 1 |
| `org.ali.formula-cycloalkene` | 分類・一般式 | 2 | 本文 | 未登場 | ①0 ②44 | 2 | 1〜2 |  | 2 |
| `org.ali.homolog` | 分類・一般式 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.unsaturation` | 分類・一般式 | 2 | 発展欄 | 基本 | ①0 ②44 | 2 | 1〜2 |  | 2 |
| `org.ali.suffix` | 分類・一般式 | 2 | 見あたらない（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.ali.alkane-shape` | アルカン | 1 | 本文（弱） | 未登場 | ①未 ②0 | 1 | 1〜4 |  | 1 |
| `org.ali.alkane-rotation` | アルカン | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-substitution` | アルカン | 1 | 本文（弱） | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.ali.alkane-chlorination` | アルカン | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.ali.alkane-names` | アルカン | 1 | 本文 | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-bp` | アルカン | 2 | 本文 | 未登場 | ①未 ②5 | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-state` | アルカン | 1 | 本文 | 未登場 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-solubility` | アルカン | 1 | 本文（弱） | 未登場 | ①未 ②5 | 1 | 1〜4 |  | 1 |
| `org.ali.methane-prep` | アルカン | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.methane-props` | アルカン | 1 | 本文 | 未登場 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-combustion` | アルカン | 1 | 本文 | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.ali.cyclo-props` | シクロアルカン | 2 | 本文（弱） | 未登場 | ①未 ②4 | 2 | 1〜4 |  | 2 |
| `org.ali.cyclo-strain` | シクロアルカン | 3 | 発展欄 | 未登場 | ①未 ②4 | 3 | 2〜4 |  | 3 |
| `org.ali.alkene-functional` | アルケン | 1 | 本文 | 未登場 | ①未 ②2 | 1 | 1〜2 |  | 1 |
| `org.ali.alkene-shape` | アルケン | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-bondlength` | アルケン | 3 | 見あたらない（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.ali.alkene-addition` | アルケン | 1 | 本文（弱） | プロセス＋基本 | ①未 ②3 | 1 | 1 |  | 1 |
| `org.ali.alkene-h2` | アルケン | 2 | 本文 | 基本 | ①0 ②25 | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-h2-catalyst` | アルケン | 2 | 本文 | 未登場 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-h2o` | アルケン | 2 | 本文（弱） | 基本 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-hx` | アルケン | 2 | 本文（弱） | 未登場 | ①未 ②4 | 2 | 1〜4 |  | 2 |
| `org.ali.alkene-br2` | アルケン | 1 | 本文（弱） | プロセス＋基本 | ①0 ②29 | 1 | 1 |  | 1 |
| `org.ali.markovnikov` | アルケン | 3 | 本文（弱） | 発展 | ①未 ②4 | 3 | 3〜4 |  | 3 |
| `org.ali.alkene-oxidation` | アルケン | 3 | 本文（弱） | 発展 | ①未 ②12 | 3 | 3〜4 |  | 3 |
| `org.ali.unsatur-detection` | アルケン | 3 | 本文 | 発展 | ①未 ②11 | 3 | 3 |  | 3 |
| `org.ali.addition-polymer` | アルケン | 2 | 本文（弱） | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.ali.vinyl-group` | アルケン | 2 | 本文 | 未登場 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.ali.ethylene-prep` | アルケン | 2 | 本文 | 基本 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.ali.ethanol-dehydration` | アルケン | 2 | 本文 | 基本 | ①0 ②11 | 2 | 1〜2 |  | 2 |
| `org.ali.vinylchloride-prep` | アルケン | 2 | 本文 | 未登場 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.ali.alkyne-functional` | アルキン | 1 | 本文 | 未登場 | ①未 ②4 | 1 | 1〜2 |  | 1 |
| `org.ali.alkyne-shape` | アルキン | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.alkyne-addition` | アルキン | 2 | 本文 | 基本 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-prep` | アルキン | 2 | 本文 | 基本 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-flame` | アルキン | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.ali.acetylene-h2o` | アルキン | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.ali.keto-enol` | アルキン | 3 | 発展欄 | 未登場 | ①0 ②29 | 3 | 2〜4 |  | 3 |
| `org.ali.acetylene-hcl` | アルキン | 2 | 本文 | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-benzene` | アルキン | 2 | 本文（弱） | 基本 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.ali.silver-acetylide` | アルキン | 2 | 本文（弱） | 基本 | ①未 ②16 | 2 | 1〜2 |  | 2 |
| `org.ali.acetic-vinyl` | アルキン | 2 | 本文（弱） | 基本 | ①0 ②25 | 2 | 1〜2 |  | 2 |
| `org.ali.isomer-classification` | 異性体・命名 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②16 | 1 | 1 |  | 1 |
| `org.ali.iso-c4h10` | 異性体・命名 | 2 | 本文（弱） | 基本 | ①未 ②12 | 2 | 1〜2 |  | 2 |
| `org.ali.iso-c5h12` | 異性体・命名 | 2 | 本文 | 基本 | ①未 ②12 | 2 | 1〜2 |  | 2 |
| `org.ali.iso-count` | 異性体・命名 | 3 | 本文 | 発展 | ①未 ②12 | 3 | 3 |  | 3 |
| `org.ali.cis-trans-def` | 異性体・命名 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②16 | 1 | 1 |  | 1 |
| `org.ali.cis-trans-condition` | 異性体・命名 | 2 | 本文（弱） | 基本 | ①未 ②17 | 2 | 1〜2 |  | 2 |
| `org.ali.chirality-def` | 異性体・命名 | 1 | 本文（弱） | プロセス＋基本 | ①11 ②38 | 1 | 1 |  | 1 |
| `org.ali.chirality-find` | 異性体・命名 | 2 | 見あたらない（弱） | 基本 | ①11 ②38 | 2 | 1〜2 |  | 2 |
| `org.ali.meso` | 異性体・命名 | 3 | 本文 | 発展 | ①未 ②4 | 3 | 3 |  | 3 |
| `org.ali.name-mainchain` | 異性体・命名 | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.ali.name-numbering` | 異性体・命名 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.ali.name-substituent-order` | 異性体・命名 | 4 | 本文（弱） | 未登場 | ①未 ②0 | 4 | 1〜4 |  | 4 |
| `org.ali.name-ene-yne-priority` | 異性体・命名 | 4 | 本文（弱） | 未登場 | ①未 ②2 | 4 | 1〜4 |  | 4 |
| `org.ali.alkyl-count` | 異性体・命名 | 2 | 本文（弱） | 未登場 | ①未 ②14 | 2 | 1〜4 |  | 2 |
| `org.ali.alkyl-chiral-min` | 異性体・命名 | 3 | 本文（弱） | 未登場 | ①未 ②12 | 3 | 1〜4 |  | 3 |
| `org.ali.chirality-ring` | 異性体・命名 | 4 | 本文（弱） | 未登場 | ①11 ②37 | 4 | 1〜4 |  | 4 |
| `org.ali.enantiomer-props` | 異性体・命名 | 2 | 本文 | 未登場 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.ali.ozonolysis-reconstruct` | アルケン | 2 | 本文 | 未登場 | ①未 ②12 | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-branch-bp` | アルカン | 3 | 発展欄 | 未登場 | ①未 ②5 | 3 | 2〜4 |  | 3 |

### alcohol（アルコール・エーテル・19件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.alcohol.hydroxy` | アルコール（総論・性質） | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.alcohol.formula` | アルコール（総論・性質） | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.alcohol.solubility` | アルコール（総論・性質） | 1 | 本文（弱） | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.alcohol.class` | アルコール（総論・性質） | 2 | 本文（弱） | 基本 | ①未 ②20 | 2 | 1〜2 |  | 2 |
| `org.alcohol.valence` | アルコール（総論・性質） | 2 | 本文 | 未登場 | ①未 ②7 | 2 | 1〜2 |  | 2 |
| `org.alcohol.polyol` | アルコール（総論・性質） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.alcohol.bp` | アルコール（総論・性質） | 2 | 本文 | 基本 | ①未 ②7 | 2 | 1〜2 |  | 2 |
| `org.alcohol.naming` | アルコール（総論・性質） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.alcohol.na` | アルコールの反応 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②12 | 1 | 1 |  | 1 |
| `org.alcohol.dehydration` | アルコールの反応 | 2 | 本文（弱） | 基本 | ①0 ②11 | 2 | 1〜2 |  | 2 |
| `org.alcohol.zaitsev` | アルコールの反応 | 3 | 本文（弱） | 未登場 | ①未 ②11 | 3 | 1〜4 |  | 3 |
| `org.alcohol.oxidation` | アルコールの反応 | 1 | 本文（弱） | プロセス＋基本 | ①0 ②23 | 1 | 1 |  | 1 |
| `org.alcohol.oxidation-reagent` | アルコールの反応 | 2 | 本文 | 未登場 | ①未 ②19 | 2 | 1〜2 |  | 2 |
| `org.alcohol.iodoform` | アルコールの反応 | 2 | 本文 | 基本 | ①0 ②22 | 2 | 1〜2 |  | 2 |
| `org.alcohol.methanol-prep` | アルコールの反応 | 1 | 本文（弱） | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.alcohol.ethanol-prep` | アルコールの反応 | 1 | 本文（弱） | プロセス＋発展 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.alcohol.ether-props` | エーテル | 1 | 本文（弱） | プロセス＋基本 | ①0 ②15 | 1 | 1 |  | 1 |
| `org.alcohol.ether-naming` | エーテル | 2 | 本文 | 基本 | ①未 ②2 | 2 | 1〜2 |  | 2 |
| `org.alcohol.ether-diethyl` | エーテル | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |

### anal（元素の確認・元素分析・18件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.anal.qualitative-def` | 元素の確認（定性） | 1 | 本文 | プロセス | ①未 ②1 | 1 | 1 |  | 1 |
| `org.anal.detect-c` | 元素の確認（定性） | 1 | 本文 | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.anal.detect-h` | 元素の確認（定性） | 1 | 本文 | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.anal.detect-n` | 元素の確認（定性） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.anal.detect-cl` | 元素の確認（定性） | 2 | 本文 | 未登場 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.anal.detect-s` | 元素の確認（定性） | 2 | 本文（弱） | 未登場 | ①未 ②3 | 2 | 1〜4 |  | 2 |
| `org.anal.quantitative-def` | 元素分析（定量） | 2 | 本文 | 未登場 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-absorb` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-order` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-oxidant` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.anal.mass-c` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②26 | 2 | 1〜2 |  | 2 |
| `org.anal.mass-h` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②26 | 2 | 1〜2 |  | 2 |
| `org.anal.mass-o` | 元素分析（定量） | 2 | 本文（弱） | 基本 | ①0 ②26 | 2 | 1〜2 |  | 2 |
| `org.anal.composition-formula` | 元素分析（定量） | 1 | 本文 | プロセス＋基本 | ①0 ②26 | 1 | 1 |  | 1 |
| `org.anal.molecular-formula` | 元素分析（定量） | 1 | 本文 | プロセス＋基本 | ①0 ②45 | 1 | 1 |  | 1 |
| `org.anal.ir-carbonyl` | 機器分析 | 4 | 本文（弱） | 未登場 | ①未 ②1 | 4 | 1〜4 |  | 4 |
| `org.anal.equivalent-h` | 機器分析 | 3 | 発展欄 | 未登場 | ①未 ②6 | 3 | 2〜4 |  | 3 |
| `org.anal.mw-from-solution` | 元素分析（定量） | 2 | 本文 | 未登場 | ①未 ②4 | 2 | 1〜2 |  | 2 |

### carbonyl（アルデヒド・ケトン／カルボン酸・エステル・43件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.carbonyl.formyl` | カルボニル化合物（総論） | 1 | 本文 | プロセス＋基本 | ①未 ②1 | 1 | 1 |  | 1 |
| `org.carbonyl.ketone-def` | カルボニル化合物（総論） | 1 | 本文 | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.carbonyl.formula-isomer` | カルボニル化合物（総論） | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.aldehyde-oxidation` | アルデヒド | 1 | 本文 | プロセス | ①1 ②0 | 1 | 1 |  | 1 |
| `org.carbonyl.silver-mirror` | アルデヒド | 1 | 本文 | プロセス＋基本 | ①1 ②16 | 1 | 1 |  | 1 |
| `org.carbonyl.fehling` | アルデヒド | 1 | 本文（弱） | プロセス＋基本 | ①1 ②17 | 1 | 1 |  | 1 |
| `org.carbonyl.formaldehyde` | アルデヒド | 1 | 本文（弱） | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.carbonyl.formaldehyde-prep` | アルデヒド | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.carbonyl.acetaldehyde-prep` | アルデヒド | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.carbonyl.ketone-no-reduce` | ケトン | 3 | 本文 | 発展 | ①未 ②16 | 3 | 3 |  | 3 |
| `org.carbonyl.acetone-props` | ケトン | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.carbonyl.acetone-prep` | ケトン | 2 | 本文 | 基本 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetone-dry-distill` | ケトン | 2 | 本文 | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.iodoform-carbonyl` | ケトン | 2 | 本文（弱） | 基本 | ①未 ②20 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.carboxy` | カルボン酸（総論・性質） | 1 | 本文（弱） | プロセス＋基本 | ①0 ②3 | 1 | 1 |  | 1 |
| `org.carbonyl.fatty-acid` | カルボン酸（総論・性質） | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.carbonyl.acidity` | カルボン酸（総論・性質） | 2 | 本文 | 基本 | ①未 ②7 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.vs-carbonic` | カルボン酸（総論・性質） | 2 | 本文 | 基本 | ①未 ②16 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.salt-strong-acid` | カルボン酸（総論・性質） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.dimer` | カルボン酸（総論・性質） | 3 | 本文（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.carbonyl.formic` | カルボン酸（各論） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.formic-reducing` | カルボン酸（各論） | 2 | 本文（弱） | 基本 | ①未 ②16 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetic` | カルボン酸（各論） | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.dicarboxylic` | カルボン酸（各論） | 3 | 本文（弱） | 未登場 | ①未 ②8 | 3 | 1〜4 |  | 3 |
| `org.carbonyl.maleic-fumaric` | カルボン酸（各論） | 3 | 発展欄 | 発展 | ①未 ②22 | 3 | 3〜4 |  | 3 |
| `org.carbonyl.maleic-anhydride` | カルボン酸（各論） | 2 | 本文（弱） | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acid-anhydride` | カルボン酸（各論） | 2 | 本文（弱） | 基本 | ①1 ②13 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetic-anhydride-props` | カルボン酸（各論） | 2 | 本文 | 未登場 | ①0 ②16 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.lactic` | カルボン酸（各論） | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.ester-bond` | エステル | 1 | 本文 | プロセス＋基本 | ①0 ②25 | 1 | 1 |  | 1 |
| `org.carbonyl.esterification` | エステル | 1 | 本文（弱） | プロセス＋基本 | ①未 ②20 | 1 | 1 |  | 1 |
| `org.carbonyl.ester-water-origin` | エステル | 3 | 本文（弱） | 未登場 | ①未 ②7 | 3 | 1〜4 |  | 3 |
| `org.carbonyl.ethyl-acetate` | エステル | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.carbonyl.ester-hydrolysis` | エステル | 2 | 本文 | 基本 | ①0 ②26 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.saponification` | エステル | 2 | 本文 | 基本 | ①0 ②25 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.ester-naming` | エステル | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.carbonyl.inorganic-ester` | エステル | 4 | 本文（弱） | 未登場 | ①未 ②0 | 4 | 1〜4 |  | 4 |
| `org.carbonyl.reduction` | カルボニル化合物（総論） | 2 | 本文 | 未登場 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.ester-valence` | エステル | 2 | 本文 | 未登場 | ①未 ②5 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.diester-arrangement` | エステル | 4 | 本文（弱） | 未登場 | ①未 ②5 | 4 | 1〜4 |  | 4 |
| `org.carbonyl.polyester-hydrolysis` | エステル | 2 | 本文 | 未登場 | ①0 ②25 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.lactone` | エステル | 2 | 本文 | 未登場 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.carbonyl.formate-ester` | エステル | 4 | 見あたらない | 未登場 | ①未 ②0 | 4 | 1〜4 |  | 4 |

### aro（芳香族炭化水素・24件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.aro.aromatic-def` | ベンゼンの構造・性質 | 1 | 本文 | 未登場 | ①未 ②5 | 1 | 1〜2 |  | 1 |
| `org.aro.benzene-structure` | ベンゼンの構造・性質 | 1 | 本文（弱） | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.aro.benzene-bond` | ベンゼンの構造・性質 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.benzene-props` | ベンゼンの構造・性質 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.homolog-formula` | ベンゼンの構造・性質 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.source` | ベンゼンの構造・性質 | 3 | 本文（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.aro.substitution-first` | 置換反応 | 2 | 本文（弱） | 基本 | ①未 ②7 | 2 | 1〜2 |  | 2 |
| `org.aro.halogenation` | 置換反応 | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.aro.nitration` | 置換反応 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②15 | 1 | 1 |  | 1 |
| `org.aro.nitrobenzene-props` | 置換反応 | 1 | 本文（弱） | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.aro.sulfonation` | 置換反応 | 2 | 本文（弱） | 基本 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.aro.sulfonic-acidity` | 置換反応 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.h2-addition` | 付加反応 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.cl2-addition` | 付加反応 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.toluene` | 同族体・誘導体 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.c8h10-isomers` | 同族体・誘導体 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.ortho-meta-para` | 同族体・誘導体 | 2 | 本文 | 基本 | ①0 ②31 | 2 | 1〜2 |  | 2 |
| `org.aro.styrene` | 同族体・誘導体 | 3 | 本文（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.aro.naphthalene` | 同族体・誘導体 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.sidechain-oxidation` | 同族体・誘導体 | 1 | 本文 | プロセス＋基本 | ①0 ②20 | 1 | 1 |  | 1 |
| `org.aro.xylene-oxidation` | 同族体・誘導体 | 2 | 本文（弱） | 基本 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.aro.naphthalene-oxidation` | 同族体・誘導体 | 3 | 本文（弱） | 発展 | ①未 ②2 | 3 | 3〜4 | **4→3**（2026-09-15） | 3 |
| `org.aro.orientation` | 置換反応 | 3 | 発展欄 | 未登場 | ①未 ②7 | 3 | 2〜4 |  | 3 |
| `org.aro.ortho-hbond` | 同族体・誘導体 | 4 | 本文（弱） | 未登場 | ①未 ②2 | 4 | 1〜4 |  | 4 |

### phenol（フェノール類・16件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.phenol.def` | 定義・例・性質 | 1 | 本文（弱） | 基本 | ①0 ②0 | 1 | 1〜2 |  | 1 |
| `org.phenol.examples` | 定義・例・性質 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.phenol.props` | 定義・例・性質 | 2 | 本文（弱） | 未登場 | ①未 ②2 | 2 | 1〜4 |  | 2 |
| `org.phenol.acidity` | 酸性と塩 | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.phenol.naoh` | 酸性と塩 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.phenol.weaker-than-carbonic` | 酸性と塩 | 2 | 本文 | 基本 | ①未 ②17 | 2 | 1〜2 |  | 2 |
| `org.phenol.phenoxide-co2` | 酸性と塩 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.phenol.na-h2` | 酸性と塩 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.phenol.fecl3` | 検出・置換反応 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②17 | 1 | 1 |  | 1 |
| `org.phenol.bromination` | 検出・置換反応 | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |
| `org.phenol.picric` | 検出・置換反応 | 2 | 本文 | 発展 | ①未 ②2 | **3** ⚠ | **3** ⚠ | **3→2**（2026-09-15） | 2 |
| `org.phenol.cumene` | 製法 | 2 | 本文 | 基本 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.phenol.old-routes` | 製法 | 2 | 本文 | 未登場 | ①未 ②11 | 2 | 1〜2 |  | 2 |
| `org.phenol.uses` | 製法 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.phenol.separation` | 酸性と塩 | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |
| `org.phenol.methyl-ether` | 検出・置換反応 | 2 | 本文 | 未登場 | ①未 ②2 | 2 | 1〜2 |  | 2 |

### aroN（芳香族窒素化合物・芳香族の分離・16件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.aroN.amino` | アニリン | 1 | 本文 | 基本 | ①未 ②10 | 1 | 1〜2 |  | 1 |
| `org.aroN.aniline-props` | アニリン | 2 | 本文（弱） | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-base` | アニリン | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-prep` | アニリン | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-detect` | アニリン | 2 | 本文 | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.aroN.acetanilide` | アニリン | 2 | 本文 | 基本 | ①未 ②18 | 2 | 1〜2 |  | 2 |
| `org.aroN.diazotization` | ジアゾ化とカップリング | 1 | 本文 | プロセス＋基本 | ①未 ②4 | 1 | 1 |  | 1 |
| `org.aroN.diazonium-decomp` | ジアゾ化とカップリング | 2 | 本文 | 未登場 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.aroN.coupling` | ジアゾ化とカップリング | 1 | 本文 | プロセス＋基本 | ①未 ②4 | 1 | 1 |  | 1 |
| `org.aroN.azo-dye` | ジアゾ化とカップリング | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.aroN.benzoic` | 芳香族カルボン酸 | 1 | 本文 | プロセス＋基本 | ①未 ②20 | 1 | 1 |  | 1 |
| `org.aroN.salicylic` | 芳香族カルボン酸 | 2 | 本文 | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.aroN.aspirin` | 芳香族カルボン酸 | 2 | 本文 | 基本 | ①未 ②13 | 2 | 1〜2 |  | 2 |
| `org.aroN.methyl-salicylate` | 芳香族カルボン酸 | 2 | 本文 | 基本 | ①未 ②12 | 2 | 1〜2 |  | 2 |
| `org.aroN.separation-principle` | 分離 | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |
| `org.aroN.separation-order` | 分離 | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |

### fat（油脂・セッケン・15件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.fat.structure` | 油脂の構造 | 1 | 本文 | プロセス＋基本 | ①未 ②10 | 1 | 1 |  | 1 |
| `org.fat.fatty-acids` | 油脂の構造 | 3 | 本文（弱） | 未登場 | ①未 ②7 | 3 | 1〜4 |  | 3 |
| `org.fat.solid-liquid` | 油脂の性質 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.fat.hardening` | 油脂の性質 | 2 | 本文 | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.fat.drying-oil` | 油脂の性質 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.fat.saponification-value` | けん化価・ヨウ素価 | 3 | 発展欄 | 発展 | ①未 ②5 | 3 | 3〜4 |  | 3 |
| `org.fat.iodine-value` | けん化価・ヨウ素価 | 3 | 発展欄 | 発展 | ①未 ②5 | 3 | 3〜4 |  | 3 |
| `org.fat.soap-prep` | セッケン | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.fat.soap-structure` | セッケン | 1 | 本文 | プロセス＋基本 | ①未 ②1 | 1 | 1 |  | 1 |
| `org.fat.micelle` | セッケン | 2 | 本文（弱） | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.fat.emulsify` | セッケン | 2 | 本文 | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.fat.soap-alkaline` | セッケン | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.fat.hard-water` | セッケン | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.fat.detergent` | 合成洗剤 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.fat.surfactant` | 合成洗剤 | 1 | 本文 | プロセス | ①未 ②1 | 1 | 1 |  | 1 |

### bio（糖・アミノ酸・タンパク質・46件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.bio.saccharide-def` | 糖類の分類 | 1 | 本文 | 基本 | ①未 ②0 | 1 | 1〜2 |  | 1 |
| `org.bio.saccharide-class` | 糖類の分類 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.bio.monosaccharide` | 単糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.bio.glucose-structure` | 単糖類 | 2 | 本文（弱） | 基本 | ①未 ②2 | 2 | 1〜2 |  | 2 |
| `org.bio.glucose-ring` | 単糖類 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②8 | 1 | 1 |  | 1 |
| `org.bio.glucose-reducing` | 単糖類 | 2 | 本文 | 基本 | ①未 ②12 | 2 | 1〜2 |  | 2 |
| `org.bio.fructose` | 単糖類 | 2 | 本文 | 基本 | ①未 ②16 | 2 | 1〜2 |  | 2 |
| `org.bio.alcohol-fermentation` | 単糖類 | 2 | 本文（弱） | 基本 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.bio.disaccharide-def` | 二糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②7 | 1 | 1 |  | 1 |
| `org.bio.maltose` | 二糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②9 | 1 | 1 |  | 1 |
| `org.bio.sucrose` | 二糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②9 | 1 | 1 |  | 1 |
| `org.bio.invert-sugar` | 二糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.bio.lactose-cellobiose` | 二糖類 | 2 | 本文 | 基本 | ①未 ②9 | 2 | 1〜2 |  | 2 |
| `org.bio.polysaccharide-def` | 多糖類 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②4 | 1 | 1 |  | 1 |
| `org.bio.starch` | 多糖類 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.bio.starch-iodine` | 多糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②1 | 1 | 1 |  | 1 |
| `org.bio.starch-hydrolysis` | 多糖類 | 2 | 本文 | 基本 | ①未 ②8 | 2 | 1〜2 |  | 2 |
| `org.bio.glycogen` | 多糖類 | 3 | 本文 | 発展 | ①未 ②1 | 3 | 3 |  | 3 |
| `org.bio.cellulose` | 多糖類 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.bio.cellulose-oh` | 多糖類 | 3 | 本文（弱） | 未登場 | ①未 ②4 | 3 | 1〜4 |  | 3 |
| `org.bio.nitrocellulose` | 多糖類 | 2 | 本文（弱） | 基本 | ①未 ②7 | 2 | 1〜2 |  | 2 |
| `org.bio.cellulose-fiber` | 多糖類 | 1 | 本文 | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.bio.amino-acid-def` | アミノ酸 | 1 | 本文（弱） | プロセス＋基本 | ①0 ②5 | 1 | 1 |  | 1 |
| `org.bio.amino-acid-sidechain` | アミノ酸 | 2 | 本文 | 基本 | ①0 ②7 | 2 | 1〜2 |  | 2 |
| `org.bio.amino-acid-chirality` | アミノ酸 | 2 | 本文（弱） | 基本 | ①0 ②0 | 2 | 1〜2 |  | 2 |
| `org.bio.amino-acid-amphoteric` | アミノ酸 | 1 | 本文 | プロセス＋基本 | ①0 ②3 | 1 | 1 |  | 1 |
| `org.bio.zwitterion-ph` | アミノ酸 | 2 | 本文 | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.bio.isoelectric-point` | アミノ酸 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②10 | 1 | 1 |  | 1 |
| `org.bio.amino-acid-crystal` | アミノ酸 | 3 | 本文 | 発展 | ①未 ②0 | 3 | 3 |  | 3 |
| `org.bio.peptide-bond` | タンパク質 | 1 | 本文 | プロセス＋基本 | ①0 ②17 | 1 | 1 |  | 1 |
| `org.bio.protein-structure` | タンパク質 | 2 | 本文 | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.bio.protein-higher` | タンパク質 | 2 | 本文 | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.bio.protein-classification` | タンパク質 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.bio.denaturation` | タンパク質 | 2 | 本文（弱） | 基本 | ①未 ②1 | 2 | 1〜2 |  | 2 |
| `org.bio.biuret` | タンパク質 | 1 | 本文 | プロセス＋基本 | ①未 ②2 | 1 | 1 |  | 1 |
| `org.bio.xanthoproteic` | タンパク質 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.bio.protein-sulfur-test` | タンパク質 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.bio.ninhydrin` | タンパク質 | 2 | 本文 | 基本 | ①未 ②5 | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-def` | 酵素 | 2 | 本文 | 基本 | ①未 ②4 | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-optimum` | 酵素 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-examples` | 酵素 | 2 | 本文 | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.bio.nucleotide` | 核酸 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.bio.dna-rna` | 核酸 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.bio.base-pair` | 核酸 | 2 | 本文（弱） | 基本 | ①未 ②3 | 2 | 1〜2 |  | 2 |
| `org.bio.glycoside` | 二糖類 | 4 | 本文（弱） | 未登場 | ①未 ②1 | 4 | 1〜4 |  | 4 |
| `org.bio.amino-acid-polyprotic` | アミノ酸 | 3 | 発展欄 | 未登場 | ①未 ②3 | 3 | 2〜4 |  | 3 |

### poly（合成高分子・35件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.poly.monomer-polymer` | 高分子の総論 | 1 | 本文（弱） | プロセス | ①未 ②17 | 1 | 1 |  | 1 |
| `org.poly.average-mw` | 高分子の総論 | 1 | 本文 | プロセス＋基本 | ①未 ②19 | 1 | 1 |  | 1 |
| `org.poly.addition-vs-condensation` | 高分子の総論 | 2 | 本文 | 基本 | ①1 ②26 | 2 | 1〜2 |  | 2 |
| `org.poly.ring-opening` | 高分子の総論 | 2 | 本文（弱） | 基本 | ①未 ②20 | 2 | 1〜2 |  | 2 |
| `org.poly.copolymer` | 高分子の総論 | 1 | 本文 | プロセス＋基本 | ①未 ②2 | 1 | 1 |  | 1 |
| `org.poly.crystalline-amorphous` | 高分子の総論 | 2 | 本文（弱） | 基本 | ①未 ②2 | 2 | 1〜2 |  | 2 |
| `org.poly.thermoplastic-thermoset` | 熱可塑性樹脂 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.polyethylene` | 熱可塑性樹脂 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.poly.vinyl-monomers` | 熱可塑性樹脂 | 1 | 本文（弱） | プロセス＋基本 | ①0 ②26 | 1 | 1 |  | 1 |
| `org.poly.pvac-pva` | 熱可塑性樹脂 | 2 | 本文 | 基本 | ①未 ②6 | 2 | 1〜2 |  | 2 |
| `org.poly.pmma-teflon` | 熱可塑性樹脂 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.pet` | 熱可塑性樹脂 | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.poly.phenol-resin` | 熱硬化性樹脂と機能性高分子 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.urea-melamine-alkyd` | 熱硬化性樹脂と機能性高分子 | 1 | 本文 | プロセス＋発展 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.superabsorbent` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.ion-exchange` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | 基本 | ①未 ②2 | 2 | 1〜2 |  | 2 |
| `org.poly.conducting` | 熱硬化性樹脂と機能性高分子 | 4 | 本文（弱） | 未登場 | ①未 ②0 | 4 | 1〜4 |  | 4 |
| `org.poly.biodegradable-recycle` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.fiber-classification` | 合成繊維 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.nylon66` | 合成繊維 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.nylon6` | 合成繊維 | 1 | 本文 | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.polyamide-silk` | 合成繊維 | 1 | 本文 | プロセス | ①未 ②0 | 1 | 1 |  | 1 |
| `org.poly.acrylic` | 合成繊維 | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.vinylon` | 合成繊維 | 1 | 本文 | プロセス＋基本 | ①未 ②2 | 1 | 1 |  | 1 |
| `org.poly.vinylon-acetal` | 合成繊維 | 1 | 本文（弱） | プロセス＋基本 | ①未 ②5 | 1 | 1 |  | 1 |
| `org.poly.fiber-polymerization-type` | 合成繊維 | 2 | 本文 | 未登場 | ①未 ②20 | 2 | 1〜2 |  | 2 |
| `org.poly.natural-rubber` | ゴム | 1 | 本文 | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.poly.rubber-cis-trans` | ゴム | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.vulcanization` | ゴム | 1 | 本文（弱） | プロセス＋基本 | ①未 ②0 | 1 | 1 |  | 1 |
| `org.poly.rubber-aging` | ゴム | 3 | 本文（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.poly.butadiene-rubber` | ゴム | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.chloroprene-rubber` | ゴム | 2 | 本文 | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.sbr-copolymer` | ゴム | 1 | 本文 | プロセス＋基本 | ①未 ②2 | 1 | 1 |  | 1 |
| `org.poly.silicone-rubber` | ゴム | 2 | 本文（弱） | 基本 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.poly.end-group` | 高分子の総論 | 2 | 本文 | 未登場 | ①未 ②2 | 2 | 1〜2 |  | 2 |

### clue（手がかりから物質に当たりを付ける・13件）

| コード | 群 | 現在 | 教科書 | セミナー | 入試 | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|--:|---|---|--:|
| `org.clue.order` | 手がかりを使う順番 | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.nitrogen-parity` | 数から当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.diethyl-ether-bp` | 沸点・融点から当たりを付ける | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.clue.acetic-mp` | 沸点・融点から当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.cho-ratio` | 数から当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.ch2o-ratio` | 数から当たりを付ける | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.clue.nitrobenzene-look` | 見た目・においから当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.aniline-look` | 見た目・においから当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.naphthalene-sublime` | 見た目・においから当たりを付ける | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.clue.formaldehyde-gas` | 沸点・融点から当たりを付ける | 2 | 本文（弱） | 未登場 | ①未 ②0 | 2 | 1〜4 |  | 2 |
| `org.clue.ester-smell` | 見た目・においから当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |
| `org.clue.amino-acid-mp` | 沸点・融点から当たりを付ける | 3 | 本文（弱） | 未登場 | ①未 ②0 | 3 | 1〜4 |  | 3 |
| `org.clue.amino-acid-mw-parity` | 数から当たりを付ける | 2 | 本文 | 未登場 | ①未 ②0 | 2 | 1〜2 |  | 2 |

---

生成元: `qa/questions.json`（317件）・`qa/data/level_matrix.jsonl` の override 欄・セミナーの材料（リポジトリの外） ／ 生成器: `qa/tools/gen_level_matrix.js`
