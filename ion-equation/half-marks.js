"use strict";
/* half-marks.js — 半反応式の ○× の印（2026-09-17・半反応式ページの作り直し 段1）。

   3ページ（一覧 halflist.html／暗記テスト halfquiz.html／係数決定 halfreaction.html）が
   **同じ部品で**読み書きする。DOM には触らない（画面はページの側が持つ）。

   ★ ユーザーの決定（2026-09-17）:
     ・**表示は1つ（最後の結果）・保存は暗記と係数で分ける**
     ・係数決定: **赤（ng）を一度でも出してクリアしたら ×、一度も出さずにクリアしたら ○**
     ・**途中でやめたら印は変えない**（＝書くのはクリアしたときだけ）

   保存形（localStorage のキー ioneq_half_marks）:
     { [halfId]: { recall: "o"|"x", build: "o"|"x", last: "recall"|"build", at: ミリ秒 } }
     recall … 暗記テストの最後の結果 ／ build … 係数決定の最後の結果
     last   … どちらを最後にやったか（表示に使う1つを決める）／ at … 最後に書いた時刻

   ⚠ localStorage が使えない環境（プライベートモード・サイトデータの拒否・サムネイル撮影）でも
   **止まらない**。読めなければ空の印として扱い、書けなければ黙って捨てる（練習そのものは続けられる）。 */
(function (root) {

const KEY = "ioneq_half_marks";
const PARTS = ["recall", "build"];

/* 既定の置き場。⚠ `window.localStorage` を**読むだけで例外**を投げる環境があるので try で囲む */
function defaultStorage() {
  try { return root.localStorage || null; } catch (e) { return null; }
}

/* 1件の形をそろえる（壊れた値・古い形は捨てる） */
function clean(entry) {
  if (!entry || typeof entry !== "object") return null;
  const out = {};
  for (const p of PARTS) if (entry[p] === "o" || entry[p] === "x") out[p] = entry[p];
  if (!out.recall && !out.build) return null;
  out.last = PARTS.includes(entry.last) && out[entry.last] ? entry.last : (out.build ? "build" : "recall");
  out.at = Number.isFinite(entry.at) ? entry.at : 0;
  return out;
}

/* 置き場を差し替えられる形で作る（テストは偽の置き場・使えない置き場を渡す） */
function create(storage) {
  const st = storage === undefined ? defaultStorage() : storage;

  function loadAll() {
    let raw = null;
    try { raw = st ? st.getItem(KEY) : null; } catch (e) { return {}; }
    if (!raw) return {};
    let obj;
    try { obj = JSON.parse(raw); } catch (e) { return {}; }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
    const out = {};
    for (const [id, v] of Object.entries(obj)) {
      const c = clean(v);
      if (c) out[id] = c;
    }
    return out;
  }

  /* 書けたら true。書けなくても例外は投げない */
  function saveAll(all) {
    try {
      if (!st) return false;
      st.setItem(KEY, JSON.stringify(all));
      return true;
    } catch (e) { return false; }
  }

  /* 【書く】part は "recall"（暗記）か "build"（係数）。ok は ○ なら true。
     ○ → × → ○ と**最後の結果で上書き**する（履歴は持たない） */
  function record(id, part, ok, now) {
    if (!id || !PARTS.includes(part)) return null;
    const all = loadAll();
    const e = all[id] || {};
    e[part] = ok ? "o" : "x";
    e.last = part;
    e.at = Number.isFinite(now) ? now : Date.now();
    all[id] = clean(e);
    saveAll(all);
    return all[id];
  }

  /* 【読む】1件（無ければ null） */
  function get(id) { return loadAll()[id] || null; }

  /* 【表示する1つ】最後にやった方の結果。"o" / "x" / null（まだ） */
  function shown(id) {
    const e = get(id);
    return e ? e[e.last] : null;
  }

  /* 【集計】ids（一覧に出している式）について ○・×・まだ の数。
     part を渡すとその練習だけで数える（省略すると表示と同じ「最後の結果」で数える） */
  function tally(ids, part) {
    const all = loadAll();
    const out = { o: 0, x: 0, none: 0, total: 0 };
    for (const id of ids) {
      const e = all[id];
      const m = e ? (part ? e[part] : e[e.last]) : null;
      out[m === "o" ? "o" : m === "x" ? "x" : "none"]++;
      out.total++;
    }
    return out;
  }

  return { KEY, record, get, shown, tally, loadAll };
}

/* 【係数決定の規則】赤（ng）を一度でも出したか → ○× 。⚠ 途中でやめた回はそもそも呼ばない */
function buildOk(ngSeen) { return !ngSeen; }

const api = Object.assign(create(), { create, buildOk, KEY, PARTS });
root.HalfMarks = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;

})(typeof window !== "undefined" ? window : globalThis);
