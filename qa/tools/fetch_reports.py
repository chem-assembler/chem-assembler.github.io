#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ユーザー報告（Google フォーム）の新着を取り込み、評価基準で triage するための
「triage パケット」を組み立てて出力する。

流れ:
  公開CSV → 新着行だけ抽出（状態ファイルで既読管理）→ 各報告に対象問題の現行内容と
  評価観点を添えて Markdown 出力 → これを Claude が REVIEW_CRITERIA.md(C1〜C16) で
  分類し questions.json 修正案を下書きする。

使い方（リポジトリルートで）:
  python qa/tools/fetch_reports.py            # 新着だけ処理し既読に記録
  python qa/tools/fetch_reports.py --all      # 既読を無視して全件（テスト・再確認用）
  python qa/tools/fetch_reports.py --dry       # 既読状態を更新しない（覗くだけ）
  python qa/tools/fetch_reports.py --csv PATH  # ローカルCSVから読む（オフライン検証用）

出力: 標準出力に triage パケット（Markdown）。qa/tools/last_triage.md にも保存。
状態: qa/tools/reports_seen.json（.gitignore 済み・端末ローカル）。
"""
import argparse
import csv
import hashlib
import io
import json
import os
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
QA_DIR = os.path.dirname(HERE)
QUESTIONS = os.path.join(QA_DIR, "questions.json")
STATE = os.path.join(HERE, "reports_seen.json")
OUT = os.path.join(HERE, "last_triage.md")
CONFIG = os.path.join(HERE, "reports_config.json")  # .gitignore 済み・端末ローカル

# 取得は OAuth（あなたのGoogleアカウント）で非公開シートを読む（推奨）。設定・鍵・IDは
# 公開リポに置かず、gitignore 済みの qa/tools/reports_config.json に置く:
#   {"spreadsheet_id":"...","worksheet":"フォームの回答 1",
#    "oauth_credentials":"C:/Users/xxx/.config/.gspread/credentials.json",
#    "oauth_token":"C:/Users/xxx/.config/.gspread/authorized_user.json"}
# --csv でローカルCSVからも読める（オフライン検証用）。
def load_config():
    if os.path.exists(CONFIG):
        try:
            return json.load(open(CONFIG, encoding="utf-8"))
        except Exception:
            return {}
    return {}


# フォームの列（先頭行）
COL = {"ts": "タイムスタンプ", "page": "アプリ／ページ",
       "locus": "場所（問題コード等）", "version": "バージョン", "body": "どこが気になりますか？"}


def fetch_csv(url):
    req = urllib.request.Request(url, headers={"User-Agent": "chem-qa-reports/1"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8-sig")


def load_rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def fetch_rows(cfg):
    """設定に応じて回答行(list[dict])を取得。OAuth(認証)を優先。"""
    sid = cfg.get("spreadsheet_id")
    if sid:
        try:
            import gspread
        except ImportError:
            sys.exit("gspread 未導入です。`python -m pip install gspread` を実行してください。")
        kw = {}
        if cfg.get("oauth_credentials"):
            kw["credentials_filename"] = cfg["oauth_credentials"]
        if cfg.get("oauth_token"):
            kw["authorized_user_filename"] = cfg["oauth_token"]
        # 初回のみブラウザで同意（あなたの操作）。以後はトークンで無人取得。
        gc = gspread.oauth(scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"], **kw)
        sh = gc.open_by_key(sid)
        ws = sh.worksheet(cfg["worksheet"]) if cfg.get("worksheet") else sh.sheet1
        return ws.get_all_records()
    # 旧: 公開CSV（URLを知れば誰でも読める＝非推奨）
    url = (os.environ.get("QA_REPORTS_CSV") or cfg.get("csv_url") or "").strip()
    if url:
        return load_rows(fetch_csv(url))
    sys.exit("設定がありません。qa/tools/reports_config.json に spreadsheet_id 等を設定してください"
             "（--csv でローカルCSVからも読めます）。")


def load_state():
    if os.path.exists(STATE):
        try:
            return set(json.load(open(STATE, encoding="utf-8")).get("seen", []))
        except Exception:
            return set()
    return set()


def save_state(seen):
    json.dump({"seen": sorted(seen)}, open(STATE, "w", encoding="utf-8"),
              ensure_ascii=False, indent=0)


def row_key(row):
    raw = (row.get(COL["ts"], "") + "|" + row.get(COL["body"], "") +
           "|" + row.get(COL["locus"], ""))
    return hashlib.md5(raw.encode("utf-8")).hexdigest()[:12]


def code_from_locus(locus):
    """「org.ali.alkene-addition（choice）」→ 'org.ali.alkene-addition'。文脈語なら None。"""
    locus = (locus or "").strip()
    if not locus or locus.startswith("("):
        return None
    # 全角/半角括弧の前まで
    for sep in ("（", "("):
        if sep in locus:
            locus = locus.split(sep)[0]
    locus = locus.strip()
    return locus if "." in locus else None


def find_pattern(data, code):
    for p in data["patterns"]:
        if p.get("code") == code:
            return p
    return None


def render_pattern(p):
    L = ["- knowledge: " + p.get("knowledge", "")]
    if p.get("req"):
        L.append("- 前提: " + ", ".join(p["req"]))
    for v in p.get("variants", []):
        if v["mode"] == "flip":
            L.append("- [めくり] Q: {}".format(v.get("q", "")))
            L.append("           A: {}".format(v.get("a", "")))
        else:
            L.append("- [複数選択] Q: {}".format(v.get("q", "")))
            for j, o in enumerate(v.get("options", [])):
                mark = "✓" if j in v.get("correct", []) else "・"
                L.append("      {} {}".format(mark, o))
        if v.get("supplement"):
            L.append("      補足: {}".format(v["supplement"]))
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--all", action="store_true", help="既読を無視して全件")
    ap.add_argument("--dry", action="store_true", help="既読状態を更新しない")
    ap.add_argument("--csv", help="ローカルCSVファイルから読む")
    args = ap.parse_args()

    if args.csv:
        rows = load_rows(io.open(args.csv, encoding="utf-8-sig").read())
    else:
        rows = fetch_rows(load_config())
    data = json.load(open(QUESTIONS, encoding="utf-8"))
    seen = set() if args.all else load_state()

    new = [r for r in rows if row_key(r) not in seen]
    lines = []
    lines.append("# 報告 triage パケット")
    lines.append("")
    lines.append("- 取得: {} 件中 新着 {} 件".format(len(rows), len(new)))
    lines.append("- 評価基準: qa/REVIEW_CRITERIA.md（C1〜C16）で分類し、questions.json 修正案を作る")
    lines.append("- 各報告について: ①該当基準の特定 ②具体的な修正案（変更前→後）③rubricに足す原則があれば提案")
    lines.append("")

    for i, r in enumerate(new, 1):
        locus = r.get(COL["locus"], "")
        code = code_from_locus(locus)
        p = find_pattern(data, code) if code else None
        lines.append("---")
        lines.append("## 新規報告 {}".format(i))
        lines.append("- 日時: {}".format(r.get(COL["ts"], "")))
        lines.append("- ページ: {}".format(r.get(COL["page"], "")))
        lines.append("- 場所: {}（code={}）".format(locus, code or "—"))
        lines.append("- バージョン: {}".format(r.get(COL["version"], "")))
        lines.append("- 報告内容: {}".format(r.get(COL["body"], "")))
        lines.append("")
        if p:
            lines.append("### 対象の現行内容")
            lines.append(render_pattern(p))
        elif code:
            lines.append("### 対象: code `{}` は questions.json に見つかりません（要確認）".format(code))
        else:
            lines.append("### 対象: 特定の問題ではなくページ全体／文脈なし")
        lines.append("")

    out = "\n".join(lines)
    io.open(OUT, "w", encoding="utf-8", newline="\n").write(out)
    print(out)

    if not args.dry and not args.all:
        for r in new:
            seen.add(row_key(r))
        save_state(seen)


if __name__ == "__main__":
    main()
