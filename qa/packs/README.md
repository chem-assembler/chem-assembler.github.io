# qa/packs —— 便が納める一問一答パックの置き場（一時置き）

- 便（chem-lane）が新しい問題を書いたら、ここに `<便の名前>.json`（`units` と `patterns`）を置く。
- 統合セッションが検査（`qa/tests.js` の runDataTests・写しの検査 `tools/check-copy.mjs --qa`）を通して
  **`qa/questions.json` へマージしたら、そのパックはこのフォルダから消す**。
- ⚠ **正は `qa/questions.json` だけ。** マージ後のパックを残すと、あとで直した文（写しの直し・コードの付け替え・外した問題）が
  パックに反映されず、古い文が「控え」として残り続ける（I-0118。2026-09-24 に14本・8コードぶんの食い違いを見つけて消した）。
- 消したパックは git の履歴から引ける（`git log --diff-filter=D -- qa/packs/`）。
