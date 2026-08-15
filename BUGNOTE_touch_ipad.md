# タッチ操作の不具合（iPad中心）— Fable 引き継ぎメモ

2026-07-24 記。**Opus が一次調査した段階で Fable に引き継ぎ**（CLAUDE.md のモデル方針:
「実ブラウザでしか再現しない・イベント順序・スナップ幾何が絡むバグは Opus で数回試して
直らなければ Fable へ」）。**デスクトップのプレビューでは再現できず、実機（iPad/スマホ）が必須**。

## 1. 報告された症状（ユーザー・実機）

| # | 端末 | 症状 |
|---|---|---|
| S1 | iPad | **ピンチ拡大縮小が、作画領域ではなくブラウザ全体（ページ）に効く** |
| S2 | iPad | 結合を消す**ダブルタップ・消しゴムのどちらも効かない** |
| S3 | スマホ（Android想定） | 結合は**長押し or ダブルタップで消える**（＝端末により挙動が違う） |
| S4 | タッチ全般 | **原子をタップしても消えず、結合次数の切り替えになる**（発生条件不明） |
| S5 | タッチ全般 | **原子が置けない・作図できない状態**になる（発生条件不明） |
| S6 | タッチ全般（2026-08-15 報告） | **シス/トランス整形が効かない**（結合の真ん中を狙うと。§7。S2 と同じ型の3件目） |

## 2. 現在の入力設計（該当箇所）

- 入力は **Pointer Events に統一**（`game.js:200` svg `pointerdown` / `:219` `pointermove` /
  `:264` window `pointerup`）。マウス専用の右クリック等は補助。
- タッチのブラウザ既定動作の抑止は **`touch-action: none`（`style.css:293`、`#chem-svg` のみ）**
  と **`trackPointerDown` の `preventDefault`（`game.js:940`。ただし `preventTouchDefault=true`
  のときだけ）** に依存。**`body`/`html` には touch-action 指定なし**。
- ピンチ/パンは Pointer 2本指で自前実装（`trackPointerDown` `game.js:937-966`、
  `activePointers` から中点アンカー方式でズーム＋パン。P11-M2d）。
- **viewport メタは `width=device-width, initial-scale=1.0` のみ**（`index.html:5`。
  `user-scalable`/`maximum-scale` 指定なし）。
- 結合の当たり判定は透明な太線 `svg-bond-hitbox`（`stroke-width:20`、`game.js:2771`）。
  その `pointerdown`（`game.js:2776`）で `stopPropagation()` し、`beginBondStretch` を開始。
  シングルクリック=次数トグル（`:2795`）、**ダブルクリック=切断（`:2799`）**、
  右クリック=切断（`:2804`）。
- 消しゴムでの削除はキャンバス側 `handleMouseDown` の `selectedTool==='erase'` 分岐
  （`game.js:1178-1190`。`findBondAt`→`removeBond`）。

## 3. 原因仮説（Opus 一次調査）

### iOS Safari のジェスチャ層が未抑止（S1・S5・一部S4の主因と推定）
iPad Safari はページの**ダブルタップズーム**とピンチを、`touch-action` だけでは完全には
手放さず、独自の `gesturestart`/`gesturechange` とビジュアルビューポートのズームで処理する。
本アプリは **`gesture*` を preventDefault していない**ため:
- S1: Safari のページピンチがアプリのポインタ・ピンチより優先される。
- 2本目の指/ジェスチャ認識が **Pointer 列を横取り**し、`pointerdown/move/up` の順序や
  取得が乱れる → S5（配置できない・スタック）、S4（意図した対象に当たらない）を誘発しうる。
- Android/Chrome は `touch-action:none` を厳密に尊重するため phone では概ね動く（S3）。

### 結合の当たり判定がポインタを握り、消しゴムに届かない（S2 の消しゴム分・S4）
- 結合 hitbox の `pointerdown`（`game.js:2776`）が `stopPropagation()`＋`beginBondStretch`
  するため、**キャンバス側の消しゴム分岐（`:1178`）が結合に対して発火しない** →
  「消しゴムで結合が消えない」。**マウスでも同経路**なので要確認（結合削除は実質
  ダブルクリック/右クリック頼み）。
- hitbox が 20px と太く、**原子の上に重なる**と、原子より先に hitbox がタッチを取り、
  原子タップが結合次数トグルに化ける（S4）。指の接触面積が大きいタッチで顕著。

### タッチの「削除」導線が端末依存（S2・S3）
- 結合削除は `dblclick`/`contextmenu` 依存。iOS はダブルタップをズームに使い `dblclick` が
  不安定、`contextmenu` は出ないことが多い。Android は長押しで `contextmenu` が出るため
  S3 のように長押しで消える。**タッチ共通の確実な削除操作が無い**（1タップは次数変更で紛らわしい）。

## 4. 修正方針の候補（Fable が実機で検証しつつ）

- **A. iOS ジェスチャ抑止**: `document` に `gesturestart`/`gesturechange`/`gestureend` の
  `preventDefault`、`body`/`html` に `touch-action:none`＋`overscroll-behavior:none`。
  必要なら viewport に `maximum-scale=1`（`user-scalable=no` はiOSが無視/アクセシビリティ懸念）。
  → S1、そして S4/S5 のポインタ乱れの多くが収まる可能性。
- **B. 消しゴムで結合をタップ削除**: hitbox の `pointerdown` で `selectedTool==='erase'` なら
  その場で結合削除（伸縮を始めない）。→ 全タッチで消しゴムが効く。
- **C. タッチ向け削除操作の統一**: 「長押しで削除」を Pointer ベースで自前実装
  （`dblclick`/`contextmenu` 依存をやめる）。原子・結合とも共通の長押し削除に。
- **D. 当たり判定の優先順位**: 原子近傍では原子を優先（hitbox 幅を動的に絞る／原子半径内は
  原子ヒットを先に判定）。→ S4 の「原子タップが結合トグル」対策。
- **E. スタック状態のガード**: `pointercancel`/ジェスチャ割込み時に `isDragging`/`bondStretch`/
  `bondStartAtom` を確実にリセット（一部 `trackPointerDown` で実施済みだが、iOS の
  gesture 割込み経路を要点検）。→ S5。

## 5. 実施済みの修正（Fable・v152。**iPad実機での確認待ち**）

上記 A〜E を以下の形で実装した（2026-07-24）:

| 症状 | 実装 | 場所 |
|---|---|---|
| S1 ページズーム優先 | `gesturestart/change/end` を document で preventDefault（`.modal-overlay` 内は除外）。`#svg-wrapper` にも `touch-action:none`、`#chem-svg` に `-webkit-touch-callout:none` | game.js コンストラクタ末尾 / style.css |
| S5 作図不能（幽霊ポインタ） | `trackPointerDown` 冒頭で、**isPrimary なタッチ＝新しいタッチ列の開始**のとき activePointers と pinch を全破棄して自動復旧（pointerup 喪失からのスタックを解消） | game.js trackPointerDown |
| S2 消しゴムが結合に効かない | 結合 hitbox の pointerdown で `selectedTool==='erase'` なら即削除（従来は stopPropagation でキャンバス側の消しゴム処理に届かなかった） | game.js hitbox pointerdown |
| S2/S3 タッチの削除導線 | **長押し550ms**（移動12px以内・ピンチ化で中止）と**自前ダブルタップ**（同一結合へ400ms以内の2タップ。iOSはdblclick非発火のため）で削除。伸縮ドラッグ直後のタップを2回目と誤認しないガード付き | game.js hitbox pointerdown/pointerup |
| S4 原子タップが結合トグル化 | hitbox pointerdown 時に指の下 **半径16px** に原子があれば原子操作へ転送（16px = 描画半径10pxより広く、結合中点21pxには届かない。findAtomAt 既定28pxでは中点まで原子扱いになるため明示指定） | game.js hitbox pointerdown |
| 二重削除の保護 | `removeBondByGesture`（存在確認＋伸縮の履歴巻き戻し `cancelBondStretch` ＋ saveState）に削除経路を集約。Android で contextmenu と長押しタイマーが両発火しても1回だけ消える | game.js |

- 回帰テスト **I3〜I7** を追加（消しゴム/原子優先/幽霊復旧/長押し/ダブルタップ）。全90件合格。
- ヘルプ（index.html）にタッチの削除操作（長押し・2回タップ）を追記。

## 6. 残作業（実機検証）
- **iPad Safari**: S1（ピンチがキャンバスズームになるか）・S2（消しゴム/長押し/2回タップ）・
  S4/S5 の再発有無。**gesture preventDefault はモーダル内を除き全域**なので、モーダルの
  ピンチ文字拡大が必要なら要調整。
- **Android**: 長押しで contextmenu と自前タイマーの二重発火が showToast を2回出さないか
  （削除自体は1回に保護済み）。
- ダメなら: hitbox の `touch-action` / pointer capture（`setPointerCapture`）の検討へ。

## 7. S6: 整形モードのタップが判定線に食われる（v1410・この型の**3件目**）

**症状**（ユーザー・2026-08-15）: 「シス・トランス整形を実行したところ、整形がされなかった」。
報告では画面上部端だったが、**位置は関係ない**（どこでも起きる）。

**型は S2（消しゴムが結合に効かない）とまったく同じ。** 結合の判定線
（`svg-bond-hitbox`・`stroke-width:20`）の `pointerdown` が冒頭で `stopPropagation()` するため、
**キャンバス側（`handleMouseDown`）のモード分岐に届かない**。v152 では消しゴムの分岐だけを
判定線に足したので、**あとから増えたモードが全部取り残されていた**。

**「無反応」では済まなかった**（実ブラウザで実測）。離したときの `click` が次数トグルに落ちるので、
2-ブテンの C=C を狙って **C≡C に化ける**。触っている人には「整形されないうえに三重結合になった」
としか見えない。タッチだと連続タップが自前のダブルタップ削除（400ms）に当たり、**結合ごと消える**。

**穴を持っていたモード（すべて実測で確認・v1410 以前）**

| モード | 狙う場所 | 直す前 | 直した後 |
|---|---|---|---|
| シス/トランス整形 | C=C の中点（炭素から21px） | 整形されず C=C → C≡C | ±120° に整形（trans 保存） |
| 不斉炭素マーク | 炭素から20px | マーク付かず C=C → C≡C | マークが付く |
| α/β 面マーク | 炭素から20px | C=C → C≡C（2回目は結合ごと消えた） | 構造は不変 |
| 反応させる分子を選ぶ | C=C の中点 | 選ばれず C=C → C≡C | 選択1件 |
| 立体対照の炭素選び | 炭素から20px | 選ばれず C=C → C≡C | 炭素が渡る |
| 主鎖と番号の表示中 | C=C の中点 | 断り文が出ないまま C=C → C≡C | 構造は不変 |

**なぜ「効くときもある」ように見えたか**: 整形モードのホバーのハイライト（7px の帯）が
`pointer-events` を持っており、**マウスで軸をなぞったときだけ**判定線より先に当たって
そのままキャンバスへ抜けていた。軸から 3.5px 外すと帯を外れて判定線に食われる。
タッチにはホバーが無いので**この盾がそもそも無い** ＝ iPad では常に死んでいた。

**直し方**（`game.js`）
- 「タップに別の意味があるモード」の一覧を **`tapHasOtherMeaning()`** に切り出し、
  見出し（🔍）の `canvasEntryEnabled()` と判定線の両方が**同じ一覧**を読む。
  判定線側は `bondGestureEnabled()`（＝ 上記＋主鎖と番号の表示中）で聞く。
  **モードが増えても一覧に足すだけで両方が守られる**（分岐を1つずつ足したのが S2 の敗因）。
- 判定線の `pointerdown` は、当てはまるときは**何もせずキャンバスへ流す**（`stopPropagation` しない）。
- `pointerup` / `click` / `dblclick` / `contextmenu` にも同じ門番を置く。
  ⚠ **押した時の判断を `_bondToCanvas` で持ち回る**。立体対照の炭素選びは
  `handlePick` が成功した時点で `picking` を自分で降ろすので、**click の時刻に聞き直すと
  「もう普通のモード」と答えて次数を上げる**（この修正の途中で実測して見つけた）。
- ハイライトに `pointer-events="none"` を付け、偶然の盾を外して経路を1本にした。

**回帰テスト I8〜I10**（否定対照は **I8 の中点**）。
⚠ 既存の `c.clickAt` は **`svg` に直接**撃つのでヒットテストを飛ばす ＝ 判定線を一度も通らない。
`RF1`（整形）はそれで緑のままだった。I8〜I10 は判定線そのものを相手にする。
**原子の近くを叩く検査は、この穴が空いたままでも緑になる**（そこは元々通っていた）。

## 8. 参考
- 直前までの作業は P12-1（異性体の書き出し練習）調整で v151。タッチ不具合はそれとは独立。
- 関連の既存タッチ実装: P11-M2d（2本指パン）、P11-M2b（モバイルのツール削減。消しゴムは存置）。
