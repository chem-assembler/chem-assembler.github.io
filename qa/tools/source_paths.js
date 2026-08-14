/**
 * 傍用問題集（セミナー）と教科書から起こした材料の置き場所。
 *
 * ⚠ **リポジトリの外に置く。** `qa/` の下は GitHub Pages がそのまま配るので、
 *   `qa/data/seminar_map_ch20.jsonl` は URL を叩けば誰でも読める。
 *   中身は「基本例題42 → 扱っている知識項目」の対応表なので、
 *   **傍用問題集の索引を公開しているのと同じ**になる（2026-08-13 に気づいて外へ出した）。
 *
 * **扱いの方針（ユーザー判断・2026-08-13）:**
 *
 * | 出どころ | 出典を示す | 問題を引く逆引き | 難易度・頻度の材料 |
 * |---|:--:|:--:|:--:|
 * | **入試問題** | ○（大学・年・大問番号） | **○** | ○ |
 * | **セミナー・教科書** | ✕ | **✕** | ○（**参考値まで**） |
 *
 * だから `questions.json` の `evidence` に載るのは**区分の語だけ**
 * （`本文` / `発展欄` / `見あたらない` / `プロセス` / `基本` / `発展` / `未登場`）で、
 * 問題番号は載せない。`qa/tests.js` の著作権検査が、配信物に問題番号が
 * 混ざっていないかを見張る。
 *
 * 場所を変えたいときは環境変数 `QA_SOURCE_DIR` で上書きする。
 */

const fs = require('fs');
const path = require('path');

const SOURCE_DIR = process.env.QA_SOURCE_DIR
    || 'C:/Users/maequ/マイドライブ/化学/問題集/_解析/workbook';

/** 材料のファイル名 → 絶対パス */
const at = (f) => path.join(SOURCE_DIR, f);

/** 材料の置き場所にある、名前が pattern に合うファイル（無ければ空配列） */
const list = (pattern) => {
    if (!fs.existsSync(SOURCE_DIR)) return [];
    return fs.readdirSync(SOURCE_DIR).filter((f) => pattern.test(f)).sort();
};

/** 置き場所が見つからないときに、何をすればよいかを言う */
const missingMessage = () => `材料の置き場所が見つからない: ${SOURCE_DIR}\n`
    + '  セミナー・教科書の材料はリポジトリの外に置いている（公開しないため）。\n'
    + '  別の場所にあるなら環境変数 QA_SOURCE_DIR で指す。';

module.exports = { SOURCE_DIR, at, list, missingMessage };
