#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""qa/questions.json から検収用マークダウンを生成する。
使い方: リポジトリルートで  python qa/tools/gen_review.py
出力:  qa/REVIEW_<unit>.md （単元ごと）

questions.json が唯一の正。修正はこのスクリプトではなく questions.json 側に入れ、再生成する。

■ レビュー状態の保持（v2）
各設問行に `<!--k:CODE#MODE h:HASH-->` のアンカーを埋め込む。再生成時に既存 MD を読み、
- 内容ハッシュが一致（＝前回レビュー時から中身が変わっていない）かつ [x] だった項目 → [x] を維持
- 内容が変わっていた項目 → [ ] に戻し「▶ 前回レビュー後に内容が変わりました。再確認してください」を自動付与
- ユーザーが書いた「▶ …」メモ（行頭が ▶ の行）は (CODE, MODE) に紐づけて保持
これで questions.json を触るたびにチェックが消える事故を防ぐ。
"""
import json
import os
import re
import hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
QA_DIR = os.path.dirname(HERE)
SRC = os.path.join(QA_DIR, "questions.json")

DIFF = {1: "Lv1生存", 2: "Lv2標準", 3: "Lv3受験標準", 4: "Lv4難関"}
MODE_LABEL = {"flip": "めくり", "choice": "複数選択"}
LABEL_MODE = {v: k for k, v in MODE_LABEL.items()}
AUTO_NOTE = "前回レビュー後に内容が変わりました。再確認してください"


def load():
    with open(SRC, encoding="utf-8") as f:
        return json.load(f)


def variant_hash(knowledge, v):
    """設問1つの内容ハッシュ。knowledge も含める（知識が変われば再確認したい）。"""
    payload = json.dumps({"k": knowledge, "v": v}, ensure_ascii=False, sort_keys=True)
    return hashlib.md5(payload.encode("utf-8")).hexdigest()[:8]


ANCHOR_RE = re.compile(r"<!--k:(?P<code>[^ #]+)#(?P<mode>flip|choice) h:(?P<hash>[0-9a-f]+)-->")
CHECK_RE = re.compile(r"^- \[(?P<mark>[ x])\] \*\*(?:めくり|複数選択)\*\*")
SECTION_RE = re.compile(r"^## \d+\. `(?P<code>[^`]+)`")


def parse_existing(path):
    """既存 MD から {(code,mode): {'checked':bool,'hash':str,'notes':[str]}} を作る。"""
    state = {}
    if not os.path.exists(path):
        return state
    cur_code = None
    cur_key = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            m = SECTION_RE.match(line)
            if m:
                cur_code = m.group("code")
                cur_key = None
                continue
            cm = CHECK_RE.match(line)
            if cm and cur_code:
                am = ANCHOR_RE.search(line)
                mode = am.group("mode") if am else None
                if mode is None:
                    # 旧フォーマット（アンカーなし）：ラベルからモードを推定
                    mode = "flip" if "めくり" in line else "choice"
                cur_key = (cur_code, mode)
                state.setdefault(cur_key, {"checked": False, "hash": None, "notes": []})
                state[cur_key]["checked"] = (cm.group("mark") == "x")
                if am:
                    state[cur_key]["hash"] = am.group("hash")
                continue
            # ▶ メモ行（自動付与ぶんは保存しない：再生成で作り直す）。
            # 先頭の箇条書き記号を落として「▶ …」から正規化（再生成で "- " が二重化しないように）
            if cur_key and "▶" in line and AUTO_NOTE not in line:
                state[cur_key]["notes"].append(line[line.find("▶"):].rstrip())
    return state


def render_unit(data, unit, prev):
    pats = [p for p in data["patterns"] if p["unit"] == unit["id"]]
    n_flip = sum(1 for p in pats for v in p["variants"] if v["mode"] == "flip")
    n_choice = sum(1 for p in pats for v in p["variants"] if v["mode"] == "choice")
    total = sum(len(p["variants"]) for p in pats)

    L = []
    L.append("# 一問一答 内容検収シート — {}".format(unit["name"]))
    L.append("")
    L.append("- 生成元: `qa/questions.json`（schemaVersion {}） … このMDは自動生成。**修正は questions.json 側へ**".format(
        data.get("meta", {}).get("schemaVersion", "?")))
    L.append("- 領域: {} ／ {}".format(unit.get("category_l", ""), unit.get("category_m", "")))
    L.append("- 知識項目 **{}件** ／ 設問 **{}問**（めくり {} ＋ 複数選択 {}）".format(
        len(pats), total, n_flip, n_choice))
    L.append("- 使い方: 確認したら各設問の `[ ]` を `[x]` に。要修正は行末か直下に「▶ …」でメモ。")
    L.append("  チェックと ▶ メモは再生成後も**保持**されます（内容が変わった項目だけ自動で `[ ]` に戻り再確認を促します）。")
    L.append("- 評価基準: [REVIEW_CRITERIA.md](REVIEW_CRITERIA.md)（作問方針＝評価基準。レビューで随時更新）")
    L.append("")
    L.append("---")
    L.append("")

    for i, p in enumerate(pats, 1):
        tags = " ".join("#" + t for t in p.get("tags", []))
        code = p.get("code", p.get("id", "?"))
        grp = p.get("group", "")
        knowledge = p.get("knowledge", "")
        L.append("## {}. `{}`  ·  {}  ·  {}  ·  {}".format(i, code, grp, DIFF.get(p.get("difficulty"), "難易度?"), tags))
        L.append("**知識**: {}".format(knowledge or "（未記入）"))
        if p.get("req"):
            L.append("前提: {}".format(" , ".join("`{}`".format(r) for r in p["req"])))
        if p.get("link"):
            L.append("🔧 飛び道具: {}（build: {}）".format(p["link"].get("label", ""), p["link"].get("build", "")))
        L.append("")
        for v in p["variants"]:
            mode = v["mode"]
            h = variant_hash(knowledge, v)
            key = (code, mode)
            st = prev.get(key)
            keep_check = bool(st and st["checked"] and st["hash"] == h)
            changed = bool(st and st["checked"] and st["hash"] not in (None, h))
            box = "x" if keep_check else " "
            label = MODE_LABEL[mode]
            L.append("- [{}] **{}** <!--k:{}#{} h:{}-->".format(box, label, code, mode, h))
            if mode == "flip":
                L.append("  - Q: {}".format(v["q"]))
                L.append("  - A: **{}**".format(v["a"]))
            else:
                L.append("  - Q: {}".format(v["q"]))
                L.append("  - 選択肢:")
                for idx, opt in enumerate(v["options"]):
                    mark = "✓" if idx in v["correct"] else "・"
                    L.append("    - {} {}".format(mark, opt))
            if v.get("supplement"):
                L.append("  - 補足: {}".format(v["supplement"]))
            # 保持していたユーザーメモ
            if st:
                for note in st["notes"]:
                    L.append("  - {}".format(note))
            # 内容が変わっていたら再確認を自動付与
            if changed:
                L.append("  - ▶ {}".format(AUTO_NOTE))
        L.append("")
        L.append("---")
        L.append("")

    return "\n".join(L)


def main():
    data = load()
    for unit in data["units"]:
        out = os.path.join(QA_DIR, "REVIEW_{}.md".format(unit["id"]))
        prev = parse_existing(out)
        md = render_unit(data, unit, prev)
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write(md)
        kept = sum(1 for k, s in prev.items() if s["checked"])
        print("wrote {}  (前回チェック {} 件を評価)".format(out, kept))


if __name__ == "__main__":
    main()
