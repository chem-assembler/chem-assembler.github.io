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

## 5. Opus が試したこと / 未検証
- 一次調査のみ（コード読解）。**コード変更は未実施**（実機検証できないため、入力/ジェスチャの
  改変は避けた）。回帰テスト（test.html 85件）はデスクトップで全緑の状態。
- **要実機検証**: 上記 A〜E は iPad（Safari）と Android で実際に確認しながら進める必要あり。
  再現手順の特定（特に S4/S5 の条件）も実機で。

## 6. 参考
- 直前までの作業は P12-1（異性体の書き出し練習）調整で v151。タッチ不具合はそれとは独立。
- 関連の既存タッチ実装: P11-M2d（2本指パン）、P11-M2b（モバイルのツール削減。消しゴムは存置）。
