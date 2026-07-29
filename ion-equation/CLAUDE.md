# Ion-Equation（イオンでみる化学反応式）

中学理科〜高校化学基礎向け。化学反応式（中和・沈殿・気体発生…）を、水中のイオンの組み変わりアニメで納得させる学習アプリ。
vanilla JS + SVG、ビルドなし・静的配信。親ディレクトリの Chem-Assembler の姉妹プロジェクトで、開発ルールも同じ流儀。

公開URL: https://chem.schoollenz.com/ion-equation/ （= https://chem-assembler.github.io/ion-equation/）
（**このディレクトリ自体が chem-assembler.github.io リポジトリ（親＝Chem-Assembler）の `/ion-equation/` サブディレクトリ**。
専用リポジトリは持たず、ここで直接開発・直接コミットする。
※旧方式（別フォルダ `../IonEquation/` で開発 → 8ファイルを手動コピー）は 2026-07-24 に廃止・統合。
デプロイ手順: このディレクトリで編集 → 親リポジトリのルートで `git add ion-equation && git commit` → `git push origin main`。
公開後は https://chem.schoollenz.com/ion-equation/test.html で ALL PASS を確認する）

## 必読

- **DEVELOPMENT.md** — コンセプト・設計原則・ロードマップ。進行状況はこのチェックリストが正

## 重要ルール

- model.js は DOM 非依存の純粋ロジック。判定は個数・原子数のみ（座標は見た目専用）
- 全ファイル UTF-8（BOMなし）。コミット前に文字化けパターン（`縺`・`繧`・`繝`）確認
- バージョン `vNN` は index.html・test.html のキャッシュバスターとヘッダー表示を同時更新
- 1修正=1コミット。**コミット前に test.html 全合格＋ブラウザで実挙動確認**
- 起動は**リポジトリルートから配信**して `/ion-equation/` を開く（例: ルートで `python -m http.server 8123` → `http://localhost:8123/ion-equation/`）。
  v110 から反応インデックスと test.html が `../ratio/model.js` を読む（アプリ横断の辞書引き）ため、ion-equation だけを配信すると横断リンクとその回帰テストが落ちる。
  公開先（GitHub Pages）もリポジトリルート配信なので、これが本番と同じ条件になる
