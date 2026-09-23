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
| 教科書→Lv | **教科書だけから見た Lv**。本文 ≤3（強い）／発展欄 ≥2（弱い）／見あたらない・（弱） —（何も言えない） |
| セミナー | プロセス / 基本 / 発展 / 未登場。「プロセス＋発展」はプロセスに出るうえ、問題では発展にだけ出る |
| セミナー→Lv | **セミナーだけから見た Lv**。プロセス 1（強い）／基本 ≤2（強い）／発展 ≥3（弱い）／未登場 —（何も言えない） |
| 入試 | ① 解答になった回数（未 ＝ 判定していない）／② 手筋として使われた問題数。**「②44→84」は evidence の値が古く、今の入試データでは 84**（下の節） |
| 入試→Lv | **規則なし（空欄）**。§7-2「出題頻度は difficulty に混ぜない」・§7-3「閾値は先に決めない」。入試は優先度（priority）の材料 |
| 目安 §3-2 | `apply_seminar_levels.js` の規則が出す値（基本に出て Lv3以上 → 2／発展にだけ出て Lv2以下 → 3／ほかは動かさない） |
| 目安 §7-2 | `build_evidence.js` の許容区間（教科書 × セミナー）。いまの Lv が区間の外なら ⚠ と行き先 |
| 上書き | ユーザーが決めた値（元→上書き・日付）。理由は上の節 |
| 最終 | 上書きがあればその値、無ければ現在の値。**現在と必ず一致する** |

**↑ ↓ の読み方**: 根拠ごとの Lv の欄で、いまの Lv（最終）が**その根拠の区間の外**にあるとき、
その根拠が Lv を**押し上げている（↑）／押し下げている（↓）**。「≥」は上へ押す側の根拠、「≤」は下へ押す側の根拠で、いまの Lv が区間の中なら矢印は付かない。
規則は `qa/tools/level_rules.js`（`BY_TEXTBOOK`・`BY_SEMINAR`・`BY_EXAM`）の1か所。

⚠ 目安 §7-2 の区間は、ほとんどの欄で「教科書の区間 ∩ セミナーの区間」になるが、**3つの欄だけ違う**（`NOT_INTERSECTION`）:
本文×未登場 は ≤3 でなく 1〜2（§7-2 の ※）／発展欄×プロセス は共通部分が空で 1（強い信号を採る）／発展欄×基本 は 2 でなく 1〜2（弱い発展欄より強い基本を採る）。

## ユーザーの上書き（10件）

| コード | 元 | 上書き | 日付 | 理由 | 記録 | 教科書→Lv | セミナー→Lv | 目安 §3-2 | 目安 §7-2 |
|---|--:|--:|---|---|---|---|---|--:|---|
| `org.anal.detect-s` | 3 | **2** | 2026-09-11 | ユーザー判断 2026-09-11（元素の確認の群で硫黄だけ1段高かった。窒素・塩素と同じく別の物質に変えて沈殿や呈色で捉える型で、上に置く理由がない）（2026-09-17 記録） | v108（8d6065e7） | — | — | 2 | 1〜4 |
| `org.aro.naphthalene-oxidation` | 4 | **3** | 2026-09-15 | ユーザー判断 2026-09-15（Lv2か3） | v112（62c47ee7） | — | ≥3 | 3 | 3〜4 |
| `org.phenol.picric` | 3 | **2** | 2026-09-15 | ユーザー判断 2026-09-15（Lv2かも） | v112（62c47ee7）・2026-09-17 承認 | ≤3 | ≥3 **↑** | **3** ⚠ | **3** ⚠ |
| `org.fat.saponification-value` | 4 | **3** | 2026-09-11 | ユーザー判断 2026-09-11（実物を読みながらの指摘で、けん化価・ヨウ素価を Lv4→3）（2026-09-17 記録） | v110（c75fdc9e） | ≥2 | ≥3 | 3 | 3〜4 |
| `org.fat.iodine-value` | 4 | **3** | 2026-09-11 | ユーザー判断 2026-09-11（実物を読みながらの指摘で、けん化価・ヨウ素価を Lv4→3）（2026-09-17 記録） | v110（c75fdc9e） | ≥2 | ≥3 | 3 | 3〜4 |
| `org.bio.glucose-structure` | 2 | **1** | 2026-09-19 | ユーザー判断 2026-09-19（鎖状構造の形＝末端にホルミル基は Lv1。不斉炭素原子の数は org.bio.glucose-chiral（Lv2）に分けた） | v141 | — | ≤2 | 1 | 1〜2 |
| `org.bio.fructose` | 2 | **1** | 2026-09-19 | ユーザー判断 2026-09-18（フルクトースの還元性だけなら Lv1 でもよい。理由は org.bio.fructose-reducing に分けた） | v139 | ≤3 | ≤2 | 1 | 1〜2 |
| `org.bio.fructose-reducing` | 2 | **3** | 2026-09-19 | ユーザー判断 2026-09-18（還元性を示す理由＝α-ヒドロキシケトンの異性化は Lv3。org.bio.fructose から分けた項目） | v139 | ≤3 | ≤2 **↓** | 3 | 1〜2 **→2** ⚠ |
| `org.bio.isoelectric-point` | 1 | **2** | 2026-09-19 | ユーザー判断 2026-09-18（等電点と電気泳動は Lv1 ではない） | v119 | — | 1 **↓** | 2 | **1** ⚠ |
| `inorg.basis.oxide-water` | 2 | **3** | 2026-09-23 | ユーザー判断 2026-09-23（「後半は難易度2ではない」＝ 反応式に加えて、ほかの酸性酸化物との違い〔自己酸化還元で酸化数が変わる〕まで問うので Lv3） | qa v151（統合セッション） | ≤3 | — | 3 | 1〜2 **→2** ⚠ |

## 機械の目安と食い違う項目（上書きの記録なし・0件）

なし。機械の目安と食い違う Lv は、すべて上の上書きに記録がある。

## 根拠がいまの Lv を押し上げ／押し下げている項目（3件）

根拠1つずつの区間から見て、いまの Lv がその外にある項目。上書きした項目か、目安 §7-2 で強い信号が弱い信号に勝った項目のどちらか。

| コード | 最終 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 上書き |
|---|--:|---|---|---|---|---|
| `org.phenol.picric` | 2 | 本文 | ≤3 | 発展 | ≥3 **↑** | **3→2**（2026-09-15） |
| `org.bio.fructose-reducing` | 3 | 本文 | ≤3 | 基本 | ≤2 **↓** | **2→3**（2026-09-19） |
| `org.bio.isoelectric-point` | 2 | 本文（弱） | — | プロセス＋基本 | 1 **↓** | **1→2**（2026-09-19） |

## 入試の手筋の数が古い項目（206件）

`questions.json` の `evidence.exam.asTool` は、`build_evidence.js --write` を最後に回した時点の入試データで数えてある。
そのあと `data/exam_usage.jsonl` が広がった（1年ぶん → 2年ぶん）ので、今のデータで数え直すと違う。一覧の入試の欄は「②古い値→今の値」と並べて書く（表では `asToolNow`）。
⚠ **入試は Lv の規則に入らない**（入試→Lv は規則なし）ので、Lv にも目安にも効かない。**questions.json の値はこの表では変えない。**

## 全項目（882件）

Lv の分布: Lv1 231件・Lv2 600件・Lv3 37件・Lv4 14件

### sec-chemistry-and-life（化学と人間生活・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.life.property-use` | 化学の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.structure-property` | 化学の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.mix-danger` | 化学の特徴 | 2 | 見あたらない | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `theo.life.identify-by-property` | 化学の特徴 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.life.material-examples` | 化学の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-substance-classification（純物質と混合物・元素・成分元素の確認・11件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.substance-class` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.element-vs-substance` | 物質の分類と分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.allotrope` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.separation-method` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.distillation-setup` | 物質の分類と分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.element-test` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.element-test-infer` | 物質の分類と分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.pure-mixture-bp` | 物質の分類と分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.compound-decompose` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.separation-example` | 物質の分類と分離 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.distillation-reason` | 物質の分類と分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-states-of-matter（熱運動と物質の三態・20件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.state.absolute-temperature` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.three-states` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.phase-change` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.heating-curve` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.phase-diagram` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.gas-pressure` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.pressure-units` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.diffusion` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.speed-distribution` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.pressure-conversion` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.mercury-density` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.melting-boiling-point` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.physical-change` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.phase-change-example` | 三態と状態変化 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.phase-enthalpy-def` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.vaporization-larger` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.heating-calc` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.phase-diagram-curves` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.ice-pressure-mp` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.piston-balance` | 三態と状態変化 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-atom-structure（原子の構造と電子配置・10件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.particle-count` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.isotope` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.radioactive-decay` | 原子の構造と電子配置 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.electron-shell` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.valence-electron` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.stable-config` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.particle-charge-mass` | 原子の構造と電子配置 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.atom-size` | 原子の構造と電子配置 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.ion-particle-count` | 原子の構造と電子配置 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.carbon-dating` | 原子の構造と電子配置 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-periodic-table（元素の周期表・11件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.basis.typical-transition` | 周期表と元素の性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.named-groups` | 周期表と元素の性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.electropositive` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.max-elements` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.three-values` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.periodic-law` | 周期表と元素の性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.typical-props` | 周期表と元素の性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.coulomb` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.ie-graph` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.electron-affinity` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.trend-direction` | 周期表と元素の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-ionic-bond（イオンとイオン結合・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.ion-charge` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.ion-name` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.polyatomic-ion` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.composition-formula` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.ionic-crystal` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.ion-noble-config` | イオン結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.cleavage-reason` | イオン結合 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-covalent-bond（共有結合と分子・16件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.valence` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.electron-pair-count` | 共有結合 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.structural-formula` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.coordinate-bond` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.molecular-shape` | 分子の形と極性 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.electron-domain` | 分子の形と極性 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.bond-angle-order` | 分子の形と極性 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.electronegativity` | 分子の形と極性 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.molecular-polarity` | 分子の形と極性 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.covalent-def` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.atom-electron-dot` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.bond-multiplicity` | 共有結合 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.pair-count-scope` | 共有結合 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.electron-formula-octet` | 共有結合 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.formula-not-shape` | 分子の形と極性 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.shape-naming` | 分子の形と極性 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-intermolecular-force（分子間力・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.imf-kinds` | 分子間力 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.hydrogen-bond` | 分子間力 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.bp-comparison` | 分子間力 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.hydride-bp` | 分子間力 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.molecular-crystal` | 分子間力 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-crystal-types（金属結合と結晶の分類・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.metallic-bond` | 結晶の種類 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.crystal-conductivity` | 結晶の種類 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.crystal-classify` | 結晶の種類 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.crystal-mp` | 結晶の種類 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.amorphous` | 結晶の種類 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.crystal-particle-force` | 結晶の種類 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.crystal-hardness` | 結晶の種類 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.structure.non-molecular-formula` | 結晶の種類 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.amorphous-reason` | 結晶の種類 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-atomic-weight（原子量・分子量・式量・4件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.mole.relative-mass` | 原子量と分子量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.atomic-weight` | 原子量と分子量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.isotope-average` | 原子量と分子量 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.formula-weight` | 原子量と分子量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-mole（物質量・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.mole.mol-def` | 物質量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.molar-quantities` | 物質量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.conversion-via-mol` | 物質量 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.atoms-in-molecule` | 物質量 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.empirical-formula` | 物質量 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-concentration（溶液の濃度・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.mole.concentration-def` | 溶液の濃度 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.molarity` | 溶液の濃度 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.concentration-convert` | 溶液の濃度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.mixing-dilution` | 溶液の濃度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.molality` | 溶液の濃度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-chemical-equation（化学反応式・4件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.mole.equation-rules` | 化学反応式 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.coefficient-method` | 化学反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.combustion-equation` | 化学反応式 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.ionic-equation` | 化学反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-stoichiometry（化学反応の量的関係・化学の基本法則・10件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.mole.coefficient-ratio` | 量的関係 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.three-row-table` | 量的関係 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.limiting-reactant` | 量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.gas-volume-ratio` | 量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.basic-laws` | 化学の基本法則 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.mole.definite-multiple` | 化学の基本法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.gas-reaction-molecule` | 化学の基本法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.mass-unit-flow` | 量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.atomic-theory` | 化学の基本法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.mole.law-identify` | 化学の基本法則 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-acid-base-definition（酸と塩基・14件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.acid-base.acid-base-properties` | 酸と塩基の定義 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.arrhenius` | 酸と塩基の定義 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.bronsted` | 酸と塩基の定義 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.bronsted-role` | 酸と塩基の定義 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.valence` | 価数と強弱 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.strong-weak` | 価数と強弱 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.ionization-degree` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.h-concentration` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.which-definition` | 酸と塩基の定義 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.ionization-equation` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.acetic-carboxy` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.hcl-vs-hydrochloric` | 価数と強弱 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.co2-acid` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.valence-from-h` | 価数と強弱 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-ph（水の電離と pH・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.acid-base.ph-def` | pH | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.water-ion-product` | pH | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.ph-dilution` | pH | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.ph-log` | pH | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.poh-def` | pH | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.kw-meaning` | pH | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.dilution-oh` | pH | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-neutralization（中和と塩・13件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.acid-base.neutralization-def` | 中和 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.acid-base.neutralization-ratio` | 中和 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.neutralization-equation` | 中和 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.neutralization-calc` | 中和 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.back-titration` | 中和 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.salt-classification` | 塩 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.salt-restore` | 塩 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.salt-solution` | 塩 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.salt-hydrolysis` | 塩 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.weak-acid-displacement` | 弱酸の遊離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.gas-by-displacement` | 弱酸の遊離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.weak-base-displacement` | 弱酸の遊離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.volatile-acid` | 弱酸の遊離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-titration（中和滴定・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.acid-base.titration-apparatus` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.titration-rinse` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.approx-ph` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.indicator` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.titration-curve` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.two-step-neutralization` | 中和滴定 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 3 | 2〜4 |  | 3 |
| `theo.acid-base.rinse-reason` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.acid-base.two-step-mixture` | 中和滴定 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 3 | 2〜4 |  | 3 |
| `theo.acid-base.curve-reverse` | 中和滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-redox-basics（酸化と還元・酸化数・10件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.redox.agent-def` | 酸化と還元 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.redox.role-table` | 酸化と還元 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.redox.oxnum-judge` | 酸化と還元 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.o-h-definition` | 酸化と還元 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.oxnum-def` | 酸化数 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.redox.oxnum-priority` | 酸化数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.oxnum-calc` | 酸化数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.oxnum-electroneg` | 酸化数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.oxnum-organic` | 酸化数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.max-oxnum` | 酸化数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-half-reaction（酸化剤と還元剤・16件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.redox.half-method` | 半反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.half-electron` | 半反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.oxidizer-products` | 半反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.reducer-products` | 半反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.dual-role` | 半反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.basic-rewrite` | 液性による書き換え | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.water-half` | 液性による書き換え | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.ozone-half` | 液性による書き換え | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.mno4-neutral` | 液性による書き換え | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.valence` | 酸化還元反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.inverse-ratio` | 酸化還元反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.assemble` | 酸化還元反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.copper-acids` | 酸化還元反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.titration-relation` | 酸化還元滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.kmno4-titration` | 酸化還元滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.iodometry` | 酸化還元滴定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-ionization-tendency（金属のイオン化傾向・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.redox.ionization-series` | イオン化傾向 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.redox.ionization-meaning` | イオン化傾向 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.metal-tree` | イオン化傾向 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.metal-water-acid` | イオン化傾向 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.redox.passivation` | イオン化傾向 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-cell-basics（酸化還元反応の応用（電池・電気分解）・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.electro.cell-poles` | 電池の仕組み | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.electro.daniell` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.porous-plate` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.which-positive` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.cell-principle` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.voltaic` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.charge-balance` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.positive-reason` | 電池の仕組み | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-chemistry-world（化学が拓く世界・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.life.bond-material` | 化学が拓く世界 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.reaction-in-life` | 化学が拓く世界 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.recycle-resource` | 化学が拓く世界 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.ceramics` | 化学が拓く世界 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.antioxidant` | 化学が拓く世界 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-vapor-pressure（蒸気圧と沸騰・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.state.vapor-liquid-equilibrium` | 蒸気圧と沸騰 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.vapor-pressure-property` | 蒸気圧と沸騰 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.vapor-pressure-max` | 蒸気圧と沸騰 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.vapor-pressure-curve` | 蒸気圧と沸騰 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.boiling-point` | 蒸気圧と沸騰 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-gas-laws（気体の法則・4件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.state.boyle-charles` | 気体の法則 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.ideal-gas-law` | 気体の法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.molar-volume` | 気体の法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.gas-molar-mass` | 気体の法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-gas-mixture（混合気体と分圧・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.state.partial-pressure` | 混合気体 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.mole-fraction` | 混合気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.component-volume` | 混合気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.mixing-gases` | 混合気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.pressure-table` | 水蒸気を含む気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.vapor-assume` | 水蒸気を含む気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.water-displacement` | 水蒸気を含む気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-real-gas（理想気体と実在気体・3件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.state.ideal-gas` | 実在気体 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.state.real-gas-deviation` | 実在気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.state.compressibility` | 実在気体 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-dissolution（溶解のしくみ・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.solution.hydration` | 溶解のしくみ | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.like-dissolves-like` | 溶解のしくみ | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.hydrophilic-group` | 溶解のしくみ | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.electrolyte` | 溶解のしくみ | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.solute-solvent` | 溶解のしくみ | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.ionic-insoluble` | 溶解のしくみ | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.iodine-hexane` | 溶解のしくみ | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-solubility（固体・気体の溶解度・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.solution.solubility-def` | 固体の溶解度 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.solubility-curve` | 固体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.recrystallization` | 固体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.evaporation` | 固体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.hydrate` | 固体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.gas-temperature` | 気体の溶解度 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.henry` | 気体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.henry-volume` | 気体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.gas-daily-life` | 気体の溶解度 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-colligative（希薄溶液の性質・13件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.solution.vapor-pressure-lowering` | 希薄溶液の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.colligative` | 希薄溶液の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.particle-count` | 希薄溶液の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.cooling-curve` | 希薄溶液の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.freezing-molar-mass` | 希薄溶液の性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.association` | 希薄溶液の性質 | 4 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 4 | 2〜4 |  | 4 |
| `theo.solution.osmosis` | 浸透圧 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.van-t-hoff` | 浸透圧 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.osmotic-molar-mass` | 浸透圧 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.colligative-everyday` | 希薄溶液の性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.concentration-kind` | 浸透圧 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.semipermeable` | 浸透圧 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.osmosis-direction` | 浸透圧 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-colloid（コロイド・12件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.solution.colloid-size` | コロイド | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.colloid-kinds` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.iron-colloid` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.colloid-properties` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.coagulation` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.salting-out` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.dispersoid` | コロイド | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.sol-gel` | コロイド | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.solution.colloid-charge` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.coagulation-use` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.colloid-stability` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.solution.dialysis-check` | コロイド | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-unit-cell（結晶の構造・非晶質・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.structure.unit-cell-count` | 結晶格子 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.coordination-packing` | 結晶格子 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.radius-edge` | 結晶格子 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.ionic-lattice` | 結晶格子 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.structure.crystal-density` | 結晶格子 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-reaction-enthalpy（反応エンタルピーと熱量・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.thermo.delta-h-sign` | 反応エンタルピー | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.thermo.equation-writing` | 反応エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.named-enthalpy` | 反応エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.element-zero` | 反応エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.neutralization-dissolution` | 反応エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.heat-quantity` | 熱量の測定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.extrapolation` | 熱量の測定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.heat-to-enthalpy` | 熱量の測定 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-hess-law（ヘスの法則と結合エンタルピー・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.thermo.hess-law` | ヘスの法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.hess-diagram` | ヘスの法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.from-formation` | ヘスの法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.hess-algebra` | ヘスの法則 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.bond-enthalpy` | 結合エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.bond-calc` | 結合エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.bond-gas-only` | 結合エンタルピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-light-energy（化学反応と光・4件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.thermo.light-wavelength` | 化学反応と光 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.photochemical` | 化学反応と光 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.photosynthesis` | 化学反応と光 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.chemiluminescence` | 化学反応と光 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-entropy（エントロピー・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.thermo.entropy-def` | エントロピー | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.thermo.entropy-sign` | エントロピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.two-tendencies` | エントロピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.entropy-temperature` | エントロピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.spontaneous-vs-rate` | エントロピー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.thermo.gibbs-energy` | エントロピー | 4 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 4 | 2〜4 |  | 4 |

### sec-fuel-cell（電池・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.electro.primary-secondary` | 実用電池と燃料電池 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.electro.fuel-cell-acid` | 実用電池と燃料電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.fuel-cell-alkaline` | 実用電池と燃料電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.lead-discharge` | 鉛蓄電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.lead-equations` | 鉛蓄電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.lead-mass` | 鉛蓄電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.lead-charge` | 鉛蓄電池 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-electrolysis-basics（電気分解・15件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.electro.anode-cathode` | 電気分解で何が反応するか | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.electro.anode-priority` | 電気分解で何が反応するか | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.cathode-priority` | 電気分解で何が反応するか | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.priority-why` | 電気分解で何が反応するか | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.electrode-equations` | 電気分解の反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.metal-halogen-eq` | 電気分解の反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.write-rule` | 電気分解の反応式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.faraday-constant` | 電気分解の量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.faraday-steps` | 電気分解の量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.align-electrons` | 電気分解の量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.series-circuit` | 電気分解の量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.parallel-circuit` | 電気分解の量的関係 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.ion-exchange-membrane` | 電気分解の工業的利用 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.copper-refining` | 電気分解の工業的利用 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.electro.molten-salt` | 電気分解の工業的利用 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-reaction-rate（反応の速さ・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.kinetics.rate-expression` | 反応速度の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.rate-ratio` | 反応速度の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.average-rate` | 反応速度の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.rate-determining` | 反応速度式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.rate-equation` | 反応速度式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.first-order-exception` | 反応速度式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.order-from-data` | 反応速度式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.first-order-data` | 反応速度式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-activation-energy（活性化エネルギーと触媒・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.kinetics.rate-factors` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.temperature` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.transition-state` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.catalyst` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.catalyst-kinds` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.concentration-collision` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.kinetics.energy-distribution` | 活性化エネルギー | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-equilibrium-constant（化学平衡と平衡定数・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.equilibrium.equilibrium-state` | 平衡定数 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.equilibrium.constant-expression` | 平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.solid-water` | 平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.k-calculation` | 平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.mol-shortcut` | 平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.distribution` | 平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.kp-kc` | 圧平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.dissociation` | 圧平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.dissociation-approx` | 圧平衡定数 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-le-chatelier（平衡の移動・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.equilibrium.le-chatelier` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.pressure-shift` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.inert-gas` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.catalyst-temperature` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.volume-trap` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.equilibrium.haber-bosch` | 平衡の移動 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-weak-acid-equilibrium（電離平衡・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.ionic-eq.ionization-constant` | 弱酸の電離平衡 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.ka-c-alpha` | 弱酸の電離平衡 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.weak-ph` | 弱酸の電離平衡 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.weak-dilution` | 弱酸の電離平衡 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.polyprotic` | 2段階電離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.k1k2` | 2段階電離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.second-step` | 2段階電離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-hydrolysis-ph（塩の加水分解と緩衝液・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.ionic-eq.hydrolysis-equation` | 塩の加水分解 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.hydrolysis-constant` | 塩の加水分解 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.ka-kh-kw` | 塩の加水分解 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.salt-ph` | 塩の加水分解 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.buffer-mechanism` | 緩衝液 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.buffer-pair` | 緩衝液 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.buffer-ph` | 緩衝液 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.buffer-titration` | 緩衝液 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-solubility-product（溶解度積・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.ionic-eq.ksp` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.precipitation-judge` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.ksp-saturated` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.mohr` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.common-ion` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.ionic-eq.sulfide` | 溶解度積 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-inorg-reaction-types（周期表と元素の性質・15件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.basis.five-types` | 無機の反応の型 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.redox-first` | 無機の反応の型 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.displacement` | 無機の反応の型 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.complex-dissolve` | 無機の反応の型 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.oxide-class` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.max-oxidation` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.oxide-water` | 酸化物とオキソ酸 | 3 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 3 | 1〜2 **→2** ⚠ | **2→3**（2026-09-23） | 3 |
| `inorg.basis.oxide-neutralization` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.oxoacid-naming` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.period3-acidity` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.outside-five` | 無機の反応の型 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.oxoacid-def` | 酸化物とオキソ酸 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.oxide-ion-equation` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.amphoteric-oxide` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.oxoacid-structure` | 酸化物とオキソ酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-hydrogen-noble-gas（水素と貴ガス・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.noble-gas-props` | 水素と貴ガス | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.noble-gas-uses` | 水素と貴ガス | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hydrogen-prep` | 水素と貴ガス | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hydrogen-reductant` | 水素と貴ガス | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hydrogen-props` | 水素と貴ガス | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.hydride-ion` | 水素と貴ガス | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-oxygen-ozone（酸素とオゾン・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.oxygen-oxidant` | 酸素とオゾン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.oxygen-prep` | 酸素とオゾン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.h2o2-dual` | 酸素とオゾン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.ozone` | 酸素とオゾン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.ozone-half` | 酸素とオゾン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-halogen（ハロゲン・16件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.halogen-state` | ハロゲン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.halogen-oxidizing` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hydrogen-halide` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.silver-halide` | ハロゲン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.fluorine` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.iodine` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.chlorine-prep` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.chlorine-washing` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.chlorine-water` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hcl-prep` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hcl-roles` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.chlorine-oxoacid` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.halogen-atom` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.bromine` | ハロゲン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.chlorine-props` | 塩素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.bleaching-powder` | 塩素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-sulfur（硫黄・13件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.sulfur-allotrope` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.h2s` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.sulfide-precipitate` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.so2-redox` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.dilute-sulfuric` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hot-conc-sulfuric` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.conc-sulfuric` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.contact-process` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.so2-props` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.sulfur-molecule` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.sulfite-reductant` | 硫黄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.hygroscopic-dehydrating` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.conc-not-weak` | 硫酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-nitrogen（窒素とリン・13件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.ammonia` | 窒素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.no-no2` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.nitric-acid` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.passivation-aqua-regia` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.haber-ostwald` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.phosphorus-allotrope` | リン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.p4o10` | リン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.phosphoric-acid` | リン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.nitrogen-gas` | 窒素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.no2-n2o4` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.nox` | 窒素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.phosphorus-formula` | リン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.superphosphate` | リン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-carbon-silicon（炭素とケイ素・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.nonmetal.carbon-allotrope` | 炭素とケイ素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.co` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.co2` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.sio2` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.silica-gel` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.silicon-element` | 炭素とケイ素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.nonmetal.amorphous-carbon` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.co-toxicity` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.nonmetal.sio2-na2co3` | 炭素とケイ素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-gas-preparation（気体の製法と性質・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.basis.gas-color` | 気体の製法 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.basis.gas-prep-type` | 気体の製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.gas-heating` | 気体の製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.gas-collection` | 気体の製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.basis.drying-agent` | 気体の製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-alkali-metal（アルカリ金属・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.alkali-water` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.alkali-storage-prep` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.alkali-reactivity` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.deliquescence-efflorescence` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.carbonate-bicarbonate` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.solvay` | アルカリ金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-alkaline-earth（2族元素・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.alkaline-earth-def` | 2族元素 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.metal.mg-vs-ca` | 2族元素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.calcium-compounds` | 2族元素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.limewater-co2` | 2族元素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.barium-sulfate` | 2族元素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.gypsum` | 2族元素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-amphoteric-metal（アルミニウム・亜鉛・スズ・鉛・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.amphoteric-elements` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.amphoteric-naoh` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.passivation` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.amphoteric-hydroxide` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.aluminium-production` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.alum` | 両性金属 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-alloy（合金・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.alloy-def` | 合金 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.metal.alloy-examples` | 合金 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.alloy-functional` | 合金 | 2 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 2 | 2〜4 |  | 2 |
| `inorg.metal.alloy-mixture` | 合金 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.metal.stainless` | 合金 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.nichrome` | 合金 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.plating-not-alloy` | 合金 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |

### sec-complex-ion（遷移元素の特徴と錯イオン・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.complex-structure` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.complex-naming` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.complex-shape` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.complex-redissolve` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.ligand-names` | 錯イオン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `inorg.metal.coordination-rule` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.complex-color` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.central-oxidation` | 錯イオン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.thiosulfate-agbr` | 錯イオン | 4 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 4 | 2〜4 |  | 4 |

### sec-iron（鉄・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.iron-smelting` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-dilute-acid` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-ion-color` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-ion-test` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-fe2-reductant` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-ore` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.iron-rust` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.fe3-oxidant` | 鉄 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-copper-silver（銅と銀・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.copper-oxidizing-acid` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.silver-tree` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.copper-ion` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.copper-sulfate-hydrate` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.silver-ion` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.silver-halide` | 銅と銀 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-transition-oxidizers（クロムとマンガン・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.metal.mn-cr-colors` | クロムとマンガン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.permanganate` | クロムとマンガン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.mno2-roles` | クロムとマンガン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.chromate-dichromate` | クロムとマンガン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.metal.chromate-precipitate` | クロムとマンガン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-precipitate（金属イオンの沈殿と炎色反応・9件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.qual.soluble-salts` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.chloride-sulfate-ppt` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.sulfate-vs-carbonate` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.hydroxide-colors` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.sulfide-ph` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.sulfide-colors` | 沈殿の生成と色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.flame-colors` | 炎色反応と水溶液の色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.flame-procedure` | 炎色反応と水溶液の色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.solution-colors` | 炎色反応と水溶液の色 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-cation-separation（金属イオンの系統分離・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `inorg.qual.separation-order` | 系統分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.separation-h2s-twice` | 系統分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.separation-nitric-acid` | 系統分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.separation-within-group` | 系統分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `inorg.qual.separation-nh4cl` | 系統分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### anal（元素の確認・元素分析・18件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.anal.qualitative-def` | 元素の確認（定性） | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②1 |  | 1 | 1 |  | 1 |
| `org.anal.detect-c` | 元素の確認（定性） | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.anal.detect-h` | 元素の確認（定性） | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.anal.detect-n` | 元素の確認（定性） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0→1 |  | 2 | 1〜2 |  | 2 |
| `org.anal.detect-cl` | 元素の確認（定性） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②1 |  | 2 | 1〜2 |  | 2 |
| `org.anal.detect-s` | 元素の確認（定性） | 2 | 本文（弱） | — | 未登場 | — | ①未 ②3→8 |  | 2 | 1〜4 | **3→2**（2026-09-11） | 2 |
| `org.anal.quantitative-def` | 元素分析（定量） | 2 | 本文 | ≤3 | 未登場 | — | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-absorb` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-order` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.anal.apparatus-oxidant` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.anal.mass-c` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②26→64 |  | 2 | 1〜2 |  | 2 |
| `org.anal.mass-h` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②26→64 |  | 2 | 1〜2 |  | 2 |
| `org.anal.mass-o` | 元素分析（定量） | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②26→64 |  | 2 | 1〜2 |  | 2 |
| `org.anal.composition-formula` | 元素分析（定量） | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②26→64 |  | 1 | 1 |  | 1 |
| `org.anal.molecular-formula` | 元素分析（定量） | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②45→94 |  | 1 | 1 |  | 1 |
| `org.anal.ir-carbonyl` | 機器分析 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②1→2 |  | 4 | 1〜4 |  | 4 |
| `org.anal.equivalent-h` | 機器分析 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②6→7 |  | 3 | 2〜4 |  | 3 |
| `org.anal.mw-from-solution` | 元素分析（定量） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②4→13 |  | 2 | 1〜2 |  | 2 |

### aliphatic（脂肪族炭化水素・88件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.ali.class-hydrocarbon` | 分類・一般式 | 1 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.class-aliphatic` | 分類・一般式 | 1 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 1 | 1〜4 |  | 1 |
| `org.ali.class-chain-ring` | 分類・一般式 | 1 | 本文 | ≤3 | 未登場 | — | ①0 ②44→84 |  | 1 | 1〜2 |  | 1 |
| `org.ali.class-saturated` | 分類・一般式 | 1 | 本文 | ≤3 | プロセス | 1 | ①0 ②43→81 |  | 1 | 1 |  | 1 |
| `org.ali.formula-alkane` | 分類・一般式 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②43→81 |  | 1 | 1 |  | 1 |
| `org.ali.formula-alkene` | 分類・一般式 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②44→84 |  | 1 | 1 |  | 1 |
| `org.ali.formula-alkyne` | 分類・一般式 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②43→81 |  | 1 | 1 |  | 1 |
| `org.ali.formula-cycloalkane` | 分類・一般式 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②43→81 |  | 1 | 1 |  | 1 |
| `org.ali.formula-cycloalkene` | 分類・一般式 | 2 | 本文 | ≤3 | 未登場 | — | ①0 ②44→84 |  | 2 | 1〜2 |  | 2 |
| `org.ali.homolog` | 分類・一般式 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.unsaturation` | 分類・一般式 | 2 | 発展欄 | ≥2 | 基本 | ≤2 | ①0 ②44→84 |  | 2 | 1〜2 |  | 2 |
| `org.ali.suffix` | 分類・一般式 | 2 | 見あたらない（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.ali.alkane-shape` | アルカン | 1 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 1 | 1〜4 |  | 1 |
| `org.ali.alkane-rotation` | アルカン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-substitution` | アルカン | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.ali.alkane-chlorination` | アルカン | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0→9 |  | 1 | 1 |  | 1 |
| `org.ali.alkane-names` | アルカン | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-bp` | アルカン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②5→11 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-state` | アルカン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-solubility` | アルカン | 1 | 本文（弱） | — | 未登場 | — | ①未 ②5→11 |  | 1 | 1〜4 |  | 1 |
| `org.ali.methane-prep` | アルカン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.methane-props` | アルカン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.alkane-combustion` | アルカン | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.cyclo-props` | シクロアルカン | 2 | 本文（弱） | — | 未登場 | — | ①未 ②4→11 |  | 2 | 1〜4 |  | 2 |
| `org.ali.cyclo-strain` | シクロアルカン | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②4→11 |  | 3 | 2〜4 |  | 3 |
| `org.ali.alkene-functional` | アルケン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②2→6 |  | 1 | 1〜2 |  | 1 |
| `org.ali.alkene-shape` | アルケン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-bondlength` | アルケン | 3 | 見あたらない（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.ali.alkene-addition` | アルケン | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②3→10 |  | 1 | 1 |  | 1 |
| `org.ali.alkene-h2` | アルケン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②25→47 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-h2-catalyst` | アルケン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②3→10 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-h2o` | アルケン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②11→28 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkene-hx` | アルケン | 2 | 本文（弱） | — | 未登場 | — | ①未 ②4→6 |  | 2 | 1〜4 |  | 2 |
| `org.ali.alkene-br2` | アルケン | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②29→55 |  | 1 | 1 |  | 1 |
| `org.ali.markovnikov` | アルケン | 3 | 本文（弱） | — | 発展 | ≥3 | ①未 ②4→6 |  | 3 | 3〜4 |  | 3 |
| `org.ali.alkene-oxidation` | アルケン | 3 | 本文（弱） | — | 発展 | ≥3 | ①未 ②12→20 |  | 3 | 3〜4 |  | 3 |
| `org.ali.unsatur-detection` | アルケン | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②11→28 |  | 3 | 3 |  | 3 |
| `org.ali.addition-polymer` | アルケン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②6→18 |  | 2 | 1〜2 |  | 2 |
| `org.ali.vinyl-group` | アルケン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②6→24 |  | 2 | 1〜2 |  | 2 |
| `org.ali.ethylene-prep` | アルケン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②11→28 |  | 2 | 1〜2 |  | 2 |
| `org.ali.ethanol-dehydration` | アルケン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②11→28 |  | 2 | 1〜2 |  | 2 |
| `org.ali.vinylchloride-prep` | アルケン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②1→4 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkyne-functional` | アルキン | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②4→9 |  | 1 | 1〜2 |  | 1 |
| `org.ali.alkyne-shape` | アルキン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkyne-addition` | アルキン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②4→22 |  | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-prep` | アルキン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②4→11 |  | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-flame` | アルキン | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.ali.acetylene-h2o` | アルキン | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→21 |  | 1 | 1 |  | 1 |
| `org.ali.keto-enol` | アルキン | 3 | 発展欄 | ≥2 | 未登場 | — | ①0 ②29→62 |  | 3 | 2〜4 |  | 3 |
| `org.ali.acetylene-hcl` | アルキン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②1→7 |  | 2 | 1〜2 |  | 2 |
| `org.ali.acetylene-benzene` | アルキン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②4→9 |  | 2 | 1〜2 |  | 2 |
| `org.ali.silver-acetylide` | アルキン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②16→42 |  | 2 | 1〜2 |  | 2 |
| `org.ali.acetic-vinyl` | アルキン | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②25→55 |  | 2 | 1〜2 |  | 2 |
| `org.ali.isomer-classification` | 異性体・命名 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②16→30 |  | 1 | 1 |  | 1 |
| `org.ali.iso-c4h10` | 異性体・命名 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②12→20 |  | 2 | 1〜2 |  | 2 |
| `org.ali.iso-c5h12` | 異性体・命名 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②12→20 |  | 2 | 1〜2 |  | 2 |
| `org.ali.iso-count` | 異性体・命名 | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②12→20 |  | 3 | 3 |  | 3 |
| `org.ali.cis-trans-def` | 異性体・命名 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②16→40 |  | 1 | 1 |  | 1 |
| `org.ali.cis-trans-condition` | 異性体・命名 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②17→42 |  | 2 | 1〜2 |  | 2 |
| `org.ali.chirality-def` | 異性体・命名 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①11 ②38→83 |  | 1 | 1 |  | 1 |
| `org.ali.chirality-find` | 異性体・命名 | 2 | 見あたらない（弱） | — | 基本 | ≤2 | ①11 ②38→76 |  | 2 | 1〜2 |  | 2 |
| `org.ali.meso` | 異性体・命名 | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②4→12 |  | 3 | 3 |  | 3 |
| `org.ali.name-mainchain` | 異性体・命名 | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.ali.name-numbering` | 異性体・命名 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.name-substituent-order` | 異性体・命名 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 4 | 1〜4 |  | 4 |
| `org.ali.name-ene-yne-priority` | 異性体・命名 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②2→6 |  | 4 | 1〜4 |  | 4 |
| `org.ali.alkyl-count` | 異性体・命名 | 2 | 本文（弱） | — | 未登場 | — | ①未 ②14→25 |  | 2 | 1〜4 |  | 2 |
| `org.ali.alkyl-chiral-min` | 異性体・命名 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②12→20 |  | 3 | 1〜4 |  | 3 |
| `org.ali.chirality-ring` | 異性体・命名 | 4 | 本文（弱） | — | 未登場 | — | ①11 ②37→75 |  | 4 | 1〜4 |  | 4 |
| `org.ali.enantiomer-props` | 異性体・命名 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②1→4 |  | 2 | 1〜2 |  | 2 |
| `org.ali.ozonolysis-reconstruct` | アルケン | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②12→20 |  | 2 | 1〜2 |  | 2 |
| `org.ali.alkane-branch-bp` | アルカン | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②5→11 |  | 3 | 2〜4 |  | 3 |
| `org.ali.cis-trans-props` | 異性体・命名 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.optical-rotation` | 異性体・命名 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.tartaric-stereo` | 異性体・命名 | 3 | 発展欄 | ≥2 | 発展 | ≥3 | ①未 ②0 |  | 3 | 3〜4 |  | 3 |
| `org.ali.organic-def` | 有機化合物の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.organic-properties` | 有機化合物の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.organic-diversity` | 有機化合物の特徴 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.formula-kinds` | 有機化合物の表し方 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.rational-formula` | 有機化合物の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.formula-same-molecular` | 有機化合物の表し方 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.organic-mp-reason` | 有機化合物の特徴 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.organic-slow-reaction` | 有機化合物の特徴 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.organic-exceptions` | 有機化合物の特徴 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.organic-organize` | 有機化合物の特徴 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.formula-use` | 有機化合物の表し方 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.ali.rational-to-molecular` | 有機化合物の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.ali.structural-formula-valence` | 有機化合物の表し方 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### alcohol（アルコール・エーテル・19件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.alcohol.hydroxy` | アルコール（総論・性質） | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.alcohol.formula` | アルコール（総論・性質） | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→9 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.solubility` | アルコール（総論・性質） | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.alcohol.class` | アルコール（総論・性質） | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②20→43 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.valence` | アルコール（総論・性質） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②7→15 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.polyol` | アルコール（総論・性質） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.bp` | アルコール（総論・性質） | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②7→14 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.naming` | アルコール（総論・性質） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.na` | アルコールの反応 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②12→25 |  | 1 | 1 |  | 1 |
| `org.alcohol.dehydration` | アルコールの反応 | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②11→29 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.zaitsev` | アルコールの反応 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②11→28 |  | 3 | 1〜4 |  | 3 |
| `org.alcohol.oxidation` | アルコールの反応 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②23→47 |  | 1 | 1 |  | 1 |
| `org.alcohol.oxidation-reagent` | アルコールの反応 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②19→41 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.iodoform` | アルコールの反応 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②22→55 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.methanol-prep` | アルコールの反応 | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.alcohol.ethanol-prep` | アルコールの反応 | 1 | 本文（弱） | — | プロセス＋発展 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.alcohol.ether-props` | エーテル | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②15→33 |  | 1 | 1 |  | 1 |
| `org.alcohol.ether-naming` | エーテル | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②2→3 |  | 2 | 1〜2 |  | 2 |
| `org.alcohol.ether-diethyl` | エーテル | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |

### aldketone（アルデヒド・ケトン・15件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.carbonyl.formyl` | カルボニル化合物（総論） | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②1→13 |  | 1 | 1 |  | 1 |
| `org.carbonyl.ketone-def` | カルボニル化合物（総論） | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.carbonyl.formula-isomer` | カルボニル化合物（総論） | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.aldehyde-oxidation` | アルデヒド | 1 | 本文 | ≤3 | プロセス | 1 | ①1 ②0 |  | 1 | 1 |  | 1 |
| `org.carbonyl.silver-mirror` | アルデヒド | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①1 ②16→42 |  | 1 | 1 |  | 1 |
| `org.carbonyl.fehling` | アルデヒド | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①1 ②17→44 |  | 1 | 1 |  | 1 |
| `org.carbonyl.formaldehyde` | アルデヒド | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.carbonyl.formaldehyde-prep` | アルデヒド | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.carbonyl.acetaldehyde-prep` | アルデヒド | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.carbonyl.ketone-no-reduce` | ケトン | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②16→42 |  | 3 | 3 |  | 3 |
| `org.carbonyl.acetone-props` | ケトン | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.carbonyl.acetone-prep` | ケトン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②11→22 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetone-dry-distill` | ケトン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②3→8 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.iodoform-carbonyl` | ケトン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②20→50 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.reduction` | カルボニル化合物（総論） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②3→5 |  | 2 | 1〜2 |  | 2 |

### carboxyl（カルボン酸・エステル・28件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.carbonyl.carboxy` | カルボン酸（総論・性質） | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②3→8 |  | 1 | 1 |  | 1 |
| `org.carbonyl.fatty-acid` | カルボン酸（総論・性質） | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.carbonyl.acidity` | カルボン酸（総論・性質） | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②7→15 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.vs-carbonic` | カルボン酸（総論・性質） | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②16→38 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.salt-strong-acid` | カルボン酸（総論・性質） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.dimer` | カルボン酸（総論・性質） | 3 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.carbonyl.formic` | カルボン酸（各論） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.formic-reducing` | カルボン酸（各論） | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②16→42 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetic` | カルボン酸（各論） | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.dicarboxylic` | カルボン酸（各論） | 3 | 本文（弱） | — | 未登場 | — | ①未 ②8→26 |  | 3 | 1〜4 |  | 3 |
| `org.carbonyl.maleic-fumaric` | カルボン酸（各論） | 3 | 発展欄 | ≥2 | 発展 | ≥3 | ①未 ②22→57 |  | 3 | 3〜4 |  | 3 |
| `org.carbonyl.maleic-anhydride` | カルボン酸（各論） | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②6→10 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acid-anhydride` | カルボン酸（各論） | 2 | 本文（弱） | — | 基本 | ≤2 | ①1 ②13→51 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.acetic-anhydride-props` | カルボン酸（各論） | 2 | 本文 | ≤3 | 未登場 | — | ①0 ②16→47 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.lactic` | カルボン酸（各論） | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.ester-bond` | エステル | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②25→53 |  | 1 | 1 |  | 1 |
| `org.carbonyl.esterification` | エステル | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②20→51 |  | 1 | 1 |  | 1 |
| `org.carbonyl.ester-water-origin` | エステル | 3 | 本文（弱） | — | 未登場 | — | ①未 ②7→23 |  | 3 | 1〜4 |  | 3 |
| `org.carbonyl.ethyl-acetate` | エステル | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.carbonyl.ester-hydrolysis` | エステル | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②26→57 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.saponification` | エステル | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②25→51 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.ester-naming` | エステル | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.carbonyl.inorganic-ester` | エステル | 4 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 4 | 1〜4 |  | 4 |
| `org.carbonyl.ester-valence` | エステル | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②5→14 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.diester-arrangement` | エステル | 4 | 本文（弱） | — | 未登場 | — | ①未 ②5→14 |  | 4 | 1〜4 |  | 4 |
| `org.carbonyl.polyester-hydrolysis` | エステル | 2 | 本文 | ≤3 | 未登場 | — | ①0 ②25→51 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.lactone` | エステル | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②4→5 |  | 2 | 1〜2 |  | 2 |
| `org.carbonyl.formate-ester` | エステル | 4 | 見あたらない | — | 未登場 | — | ①未 ②0 |  | 4 | 1〜4 |  | 4 |

### fat（油脂・セッケン・15件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.fat.structure` | 油脂の構造 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②10→19 |  | 1 | 1 |  | 1 |
| `org.fat.fatty-acids` | 油脂の構造 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②7→17 |  | 3 | 1〜4 |  | 3 |
| `org.fat.solid-liquid` | 油脂の性質 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→6 |  | 2 | 1〜2 |  | 2 |
| `org.fat.hardening` | 油脂の性質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②3→6 |  | 2 | 1〜2 |  | 2 |
| `org.fat.drying-oil` | 油脂の性質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.fat.saponification-value` | けん化価・ヨウ素価 | 3 | 発展欄 | ≥2 | 発展 | ≥3 | ①未 ②5→9 |  | 3 | 3〜4 | **4→3**（2026-09-11） | 3 |
| `org.fat.iodine-value` | けん化価・ヨウ素価 | 3 | 発展欄 | ≥2 | 発展 | ≥3 | ①未 ②5→9 |  | 3 | 3〜4 | **4→3**（2026-09-11） | 3 |
| `org.fat.soap-prep` | セッケン | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.fat.soap-structure` | セッケン | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②1→3 |  | 1 | 1 |  | 1 |
| `org.fat.micelle` | セッケン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②1→3 |  | 2 | 1〜2 |  | 2 |
| `org.fat.emulsify` | セッケン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②1→3 |  | 2 | 1〜2 |  | 2 |
| `org.fat.soap-alkaline` | セッケン | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.fat.hard-water` | セッケン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.fat.detergent` | 合成洗剤 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.fat.surfactant` | 合成洗剤 | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②1→3 |  | 1 | 1 |  | 1 |

### aro（芳香族炭化水素・24件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.aro.aromatic-def` | ベンゼンの構造・性質 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②5→10 |  | 1 | 1〜2 |  | 1 |
| `org.aro.benzene-structure` | ベンゼンの構造・性質 | 1 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.aro.benzene-bond` | ベンゼンの構造・性質 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.benzene-props` | ベンゼンの構造・性質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.homolog-formula` | ベンゼンの構造・性質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.source` | ベンゼンの構造・性質 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.aro.substitution-first` | 置換反応 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②7→15 |  | 2 | 1〜2 |  | 2 |
| `org.aro.halogenation` | 置換反応 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0→13 |  | 1 | 1 |  | 1 |
| `org.aro.nitration` | 置換反応 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②15→32 |  | 1 | 1 |  | 1 |
| `org.aro.nitrobenzene-props` | 置換反応 | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.aro.sulfonation` | 置換反応 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②11→22 |  | 2 | 1〜2 |  | 2 |
| `org.aro.sulfonic-acidity` | 置換反応 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.h2-addition` | 付加反応 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.cl2-addition` | 付加反応 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0→4 |  | 2 | 1〜2 |  | 2 |
| `org.aro.toluene` | 同族体・誘導体 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.c8h10-isomers` | 同族体・誘導体 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.ortho-meta-para` | 同族体・誘導体 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②31→61 |  | 2 | 1〜2 |  | 2 |
| `org.aro.styrene` | 同族体・誘導体 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.aro.naphthalene` | 同族体・誘導体 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.sidechain-oxidation` | 同族体・誘導体 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②20→39 |  | 1 | 1 |  | 1 |
| `org.aro.xylene-oxidation` | 同族体・誘導体 | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aro.naphthalene-oxidation` | 同族体・誘導体 | 3 | 本文（弱） | — | 発展 | ≥3 | ①未 ②2→5 |  | 3 | 3〜4 | **4→3**（2026-09-15） | 3 |
| `org.aro.orientation` | 置換反応 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②7→15 |  | 3 | 2〜4 |  | 3 |
| `org.aro.ortho-hbond` | 同族体・誘導体 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②2→4 |  | 4 | 1〜4 |  | 4 |

### phenol（フェノール類・16件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.phenol.def` | 定義・例・性質 | 1 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.phenol.examples` | 定義・例・性質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.props` | 定義・例・性質 | 2 | 本文（弱） | — | 未登場 | — | ①未 ②2→3 |  | 2 | 1〜4 |  | 2 |
| `org.phenol.acidity` | 酸性と塩 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.phenol.naoh` | 酸性と塩 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.weaker-than-carbonic` | 酸性と塩 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②17→47 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.phenoxide-co2` | 酸性と塩 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→13 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.na-h2` | 酸性と塩 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.fecl3` | 検出・置換反応 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②17→38 |  | 1 | 1 |  | 1 |
| `org.phenol.bromination` | 検出・置換反応 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→20 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.picric` | 検出・置換反応 | 2 | 本文 | ≤3 | 発展 | ≥3 **↑** | ①未 ②2→6 |  | **3** ⚠ | **3** ⚠ | **3→2**（2026-09-15） | 2 |
| `org.phenol.cumene` | 製法 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②11→22 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.old-routes` | 製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②11→22 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.uses` | 製法 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.separation` | 酸性と塩 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→30 |  | 2 | 1〜2 |  | 2 |
| `org.phenol.methyl-ether` | 検出・置換反応 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②2→3 |  | 2 | 1〜2 |  | 2 |

### aroAcid（芳香族カルボン酸・6件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.aroN.benzoic` | 芳香族カルボン酸 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②20→39 |  | 1 | 1 |  | 1 |
| `org.aroN.salicylic` | 芳香族カルボン酸 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②6→19 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.aspirin` | 芳香族カルボン酸 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②13→41 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.methyl-salicylate` | 芳香族カルボン酸 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②12→35 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.aromatic-acid-tests` | 芳香族カルボン酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.salicylic-derivatives-distinguish` | 芳香族カルボン酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### aroNitrogen（芳香族窒素化合物・10件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.aroN.amino` | アニリン | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②10→23 |  | 1 | 1〜2 |  | 1 |
| `org.aroN.aniline-props` | アニリン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②1→4 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-base` | アニリン | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-prep` | アニリン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→20 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.aniline-detect` | アニリン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②1→4 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.acetanilide` | アニリン | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②18→51 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.diazotization` | ジアゾ化とカップリング | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②4→12 |  | 1 | 1 |  | 1 |
| `org.aroN.diazonium-decomp` | ジアゾ化とカップリング | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②4→12 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.coupling` | ジアゾ化とカップリング | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②4→12 |  | 1 | 1 |  | 1 |
| `org.aroN.azo-dye` | ジアゾ化とカップリング | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |

### aroSep（芳香族の分離・5件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.aroN.separation-principle` | 分離 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→31 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.separation-order` | 分離 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→30 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.separatory-funnel` | 分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.separation-recover` | 分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.aroN.separation-four` | 分離 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### structure（構造決定・13件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.clue.order` | 手がかりを使う順番 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.nitrogen-parity` | 数から当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.diethyl-ether-bp` | 沸点・融点から当たりを付ける | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.clue.acetic-mp` | 沸点・融点から当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.cho-ratio` | 数から当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.ch2o-ratio` | 数から当たりを付ける | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.clue.nitrobenzene-look` | 見た目・においから当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.aniline-look` | 見た目・においから当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.naphthalene-sublime` | 見た目・においから当たりを付ける | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.clue.formaldehyde-gas` | 沸点・融点から当たりを付ける | 2 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `org.clue.ester-smell` | 見た目・においから当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.clue.amino-acid-mp` | 沸点・融点から当たりを付ける | 3 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.clue.amino-acid-mw-parity` | 数から当たりを付ける | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sugar（糖・25件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.bio.saccharide-def` | 糖類の分類 | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.bio.saccharide-class` | 糖類の分類 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.monosaccharide` | 単糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.bio.glucose-structure` | 単糖類 | 1 | 本文（弱） | — | 基本 | ≤2 | ①未 ②2→7 |  | 1 | 1〜2 | **2→1**（2026-09-19） | 1 |
| `org.bio.glucose-chiral` | 単糖類 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.glucose-ring` | 単糖類 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②8→18 |  | 1 | 1 |  | 1 |
| `org.bio.glucose-reducing` | 単糖類 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②12→26 |  | 2 | 1〜2 |  | 2 |
| `org.bio.fructose` | 単糖類 | 1 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②16→42 |  | 1 | 1〜2 | **2→1**（2026-09-19） | 1 |
| `org.bio.fructose-reducing` | 単糖類 | 3 | 本文 | ≤3 | 基本 | ≤2 **↓** | ①未 ②0 |  | 3 | 1〜2 **→2** ⚠ | **2→3**（2026-09-19） | 3 |
| `org.bio.alcohol-fermentation` | 単糖類 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②4→8 |  | 2 | 1〜2 |  | 2 |
| `org.bio.disaccharide-def` | 二糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②7→23 |  | 1 | 1 |  | 1 |
| `org.bio.maltose` | 二糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②9→20 |  | 1 | 1 |  | 1 |
| `org.bio.sucrose` | 二糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②9→20 |  | 1 | 1 |  | 1 |
| `org.bio.invert-sugar` | 二糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.bio.lactose-cellobiose` | 二糖類 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②9→20 |  | 2 | 1〜2 |  | 2 |
| `org.bio.polysaccharide-def` | 多糖類 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②4→10 |  | 1 | 1 |  | 1 |
| `org.bio.starch` | 多糖類 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②5→21 |  | 1 | 1 |  | 1 |
| `org.bio.starch-iodine` | 多糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②1→8 |  | 1 | 1 |  | 1 |
| `org.bio.starch-hydrolysis` | 多糖類 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②8→22 |  | 2 | 1〜2 |  | 2 |
| `org.bio.glycogen` | 多糖類 | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②1→8 |  | 3 | 3 |  | 3 |
| `org.bio.cellulose` | 多糖類 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→21 |  | 1 | 1 |  | 1 |
| `org.bio.cellulose-oh` | 多糖類 | 3 | 本文（弱） | — | 未登場 | — | ①未 ②4→23 |  | 3 | 1〜4 |  | 3 |
| `org.bio.nitrocellulose` | 多糖類 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②7→23 |  | 2 | 1〜2 |  | 2 |
| `org.bio.cellulose-fiber` | 多糖類 | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.bio.glycoside` | 二糖類 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②1→3 |  | 4 | 1〜4 |  | 4 |

### aminoAcid（アミノ酸・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.bio.amino-acid-def` | アミノ酸 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②5→8 |  | 1 | 1 |  | 1 |
| `org.bio.amino-acid-sidechain` | アミノ酸 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①0 ②7→16 |  | 2 | 1〜2 |  | 2 |
| `org.bio.amino-acid-chirality` | アミノ酸 | 2 | 本文（弱） | — | 基本 | ≤2 | ①0 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.amino-acid-amphoteric` | アミノ酸 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②3→4 |  | 1 | 1 |  | 1 |
| `org.bio.zwitterion-ph` | アミノ酸 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②3→4 |  | 2 | 1〜2 |  | 2 |
| `org.bio.isoelectric-point` | アミノ酸 | 2 | 本文（弱） | — | プロセス＋基本 | 1 **↓** | ①未 ②10→16 |  | 2 | **1** ⚠ | **1→2**（2026-09-19） | 2 |
| `org.bio.amino-acid-crystal` | アミノ酸 | 3 | 本文 | ≤3 | 発展 | ≥3 | ①未 ②0 |  | 3 | 3 |  | 3 |
| `org.bio.amino-acid-polyprotic` | アミノ酸 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②3→4 |  | 3 | 2〜4 |  | 3 |

### protein（タンパク質・酵素・18件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.bio.peptide-bond` | タンパク質 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①0 ②17→36 |  | 1 | 1 |  | 1 |
| `org.bio.protein-structure` | タンパク質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②6→12 |  | 2 | 1〜2 |  | 2 |
| `org.bio.protein-higher` | タンパク質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②1→4 |  | 2 | 1〜2 |  | 2 |
| `org.bio.protein-classification` | タンパク質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.denaturation` | タンパク質 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②1→6 |  | 2 | 1〜2 |  | 2 |
| `org.bio.biuret` | タンパク質 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②2→8 |  | 1 | 1 |  | 1 |
| `org.bio.xanthoproteic` | タンパク質 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→10 |  | 1 | 1 |  | 1 |
| `org.bio.protein-sulfur-test` | タンパク質 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→8 |  | 2 | 1〜2 |  | 2 |
| `org.bio.ninhydrin` | タンパク質 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②5→8 |  | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-def` | 酵素 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②4→16 |  | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-optimum` | 酵素 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0→2 |  | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-examples` | 酵素 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②6→18 |  | 2 | 1〜2 |  | 2 |
| `org.bio.peptide-sequence` | タンパク質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.protein-hydrolysis` | タンパク質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.color-test-inference` | タンパク質 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.kjeldahl` | タンパク質 | 4 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 4 | 2〜4 |  | 4 |
| `org.bio.enzyme-optimum-ph` | 酵素 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.enzyme-saturation` | 酵素 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 3 | 2〜4 |  | 3 |

### nucleic（核酸・8件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.bio.nucleotide` | 核酸 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→5 |  | 2 | 1〜2 |  | 2 |
| `org.bio.dna-rna` | 核酸 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→5 |  | 2 | 1〜2 |  | 2 |
| `org.bio.base-pair` | 核酸 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②3→5 |  | 2 | 1〜2 |  | 2 |
| `org.bio.nucleic-linkage` | 核酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.dna-rna-parts` | 核酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.nucleic-role` | 核酸 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.bio.base-ratio` | 核酸 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.bio.genetic-flow` | 核酸 | 3 | 発展欄 | ≥2 | 未登場 | — | ①未 ②0 |  | 3 | 2〜4 |  | 3 |

### poly（合成高分子・38件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `org.poly.monomer-polymer` | 高分子の総論 | 1 | 本文（弱） | — | プロセス | 1 | ①未 ②17→43 |  | 1 | 1 |  | 1 |
| `org.poly.average-mw` | 高分子の総論 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②19→51 |  | 1 | 1 |  | 1 |
| `org.poly.addition-vs-condensation` | 高分子の総論 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①1 ②26→60 |  | 2 | 1〜2 |  | 2 |
| `org.poly.ring-opening` | 高分子の総論 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②20→53 |  | 2 | 1〜2 |  | 2 |
| `org.poly.copolymer` | 高分子の総論 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②2→9 |  | 1 | 1 |  | 1 |
| `org.poly.crystalline-amorphous` | 高分子の総論 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②2→11 |  | 2 | 1〜2 |  | 2 |
| `org.poly.thermoplastic-thermoset` | 熱可塑性樹脂 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→17 |  | 1 | 1 |  | 1 |
| `org.poly.polyethylene` | 熱可塑性樹脂 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.poly.vinyl-monomers` | 熱可塑性樹脂 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①0 ②26→61 |  | 1 | 1 |  | 1 |
| `org.poly.pvac-pva` | 熱可塑性樹脂 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②6→19 |  | 2 | 1〜2 |  | 2 |
| `org.poly.pmma-teflon` | 熱可塑性樹脂 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.pet` | 熱可塑性樹脂 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.poly.phenol-resin` | 熱硬化性樹脂と機能性高分子 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→17 |  | 1 | 1 |  | 1 |
| `org.poly.urea-melamine-alkyd` | 熱硬化性樹脂と機能性高分子 | 1 | 本文 | ≤3 | プロセス＋発展 | 1 | ①未 ②5→15 |  | 1 | 1 |  | 1 |
| `org.poly.superabsorbent` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.ion-exchange` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②2→6 |  | 2 | 1〜2 |  | 2 |
| `org.poly.conducting` | 熱硬化性樹脂と機能性高分子 | 4 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 4 | 1〜4 |  | 4 |
| `org.poly.biodegradable-recycle` | 熱硬化性樹脂と機能性高分子 | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.fiber-classification` | 合成繊維 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.nylon66` | 合成繊維 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→11 |  | 1 | 1 |  | 1 |
| `org.poly.nylon6` | 合成繊維 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②5→11 |  | 1 | 1 |  | 1 |
| `org.poly.polyamide-silk` | 合成繊維 | 1 | 本文 | ≤3 | プロセス | 1 | ①未 ②0 |  | 1 | 1 |  | 1 |
| `org.poly.acrylic` | 合成繊維 | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0→4 |  | 2 | 1〜2 |  | 2 |
| `org.poly.vinylon` | 合成繊維 | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②2→11 |  | 1 | 1 |  | 1 |
| `org.poly.vinylon-acetal` | 合成繊維 | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②5→10 |  | 1 | 1 |  | 1 |
| `org.poly.fiber-polymerization-type` | 合成繊維 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②20→54 |  | 2 | 1〜2 |  | 2 |
| `org.poly.natural-rubber` | ゴム | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②0→5 |  | 1 | 1 |  | 1 |
| `org.poly.rubber-cis-trans` | ゴム | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.vulcanization` | ゴム | 1 | 本文（弱） | — | プロセス＋基本 | 1 | ①未 ②0→5 |  | 1 | 1 |  | 1 |
| `org.poly.rubber-aging` | ゴム | 3 | 本文（弱） | — | 未登場 | — | ①未 ②0 |  | 3 | 1〜4 |  | 3 |
| `org.poly.butadiene-rubber` | ゴム | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.chloroprene-rubber` | ゴム | 2 | 本文 | ≤3 | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.sbr-copolymer` | ゴム | 1 | 本文 | ≤3 | プロセス＋基本 | 1 | ①未 ②2→9 |  | 1 | 1 |  | 1 |
| `org.poly.silicone-rubber` | ゴム | 2 | 本文（弱） | — | 基本 | ≤2 | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.end-group` | 高分子の総論 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②2→4 |  | 2 | 1〜2 |  | 2 |
| `org.poly.polymer-def` | 高分子の総論 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `org.poly.monomer-from-repeat-unit` | 高分子の総論 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `org.poly.condensation-water-count` | 高分子の総論 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

### sec-chemistry-role（化学が果たす役割・7件）

| コード | 群 | 現在 | 教科書 | 教科書→Lv | セミナー | セミナー→Lv | 入試 | 入試→Lv | 目安 §3-2 | 目安 §7-2 | 上書き | 最終 |
|---|---|--:|---|---|---|---|---|---|--:|---|---|--:|
| `theo.life.industry-catalyst` | 化学が果たす役割 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.life.haber-issue` | 化学が果たす役割 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.life.atom-economy` | 化学が果たす役割 | 2 | 見あたらない | — | 未登場 | — | ①未 ②0 |  | 2 | 1〜4 |  | 2 |
| `theo.life.three-r` | 化学が果たす役割 | 1 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 1 | 1〜2 |  | 1 |
| `theo.life.green-chemistry` | 化学が果たす役割 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.life.ammonia-fuel` | 化学が果たす役割 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |
| `theo.life.nitrogen-fixation` | 化学が果たす役割 | 2 | 本文 | ≤3 | 未登場 | — | ①未 ②0 |  | 2 | 1〜2 |  | 2 |

---

生成元: `qa/questions.json`（882件）・`qa/data/level_matrix.jsonl` の override 欄・`qa/data/exam_usage.jsonl`・セミナーの材料（リポジトリの外） ／ 生成器: `qa/tools/gen_level_matrix.js`
