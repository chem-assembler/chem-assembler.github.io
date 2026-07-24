"use strict";
/* library-ui.js — 反応インデックス画面。window.IonLib（library.js）と SPECIES（model.js）を使い、
   分類フィルタ＋物質検索で反応を絞り込んで一覧する。ゲームプレイ（app.js）とは独立。 */
(() => {

const searchEl = document.getElementById("libSearch");
const filtersEl = document.getElementById("libFilters");
const countEl = document.getElementById("libCount");
const listEl = document.getElementById("libList");

const disp = (sp) => (SPECIES[sp] && SPECIES[sp].disp) || sp;

let lib = null;
const sel = { type: new Set(), salt: new Set(), difficulty: new Set(), unit: new Set() };
let query = "";

function chip(label, active, onClick, extraClass) {
  const b = document.createElement("button");
  b.className = "filterChip" + (active ? " on" : "") + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

function buildFilters() {
  filtersEl.innerHTML = "";
  const makeGroup = (title, keys, set, countFn, acidKey, labelFn) => {
    if (!keys.length) return;
    const wrap = document.createElement("div");
    wrap.className = "filterGroup";
    const lead = document.createElement("span");
    lead.className = "filterLead";
    lead.textContent = title;
    wrap.appendChild(lead);
    keys.forEach((k) => {
      const label = labelFn ? labelFn(k) : k;
      wrap.appendChild(chip(`${label}（${countFn(k)}）`, set.has(k),
        () => { set.has(k) ? set.delete(k) : set.add(k); render(); },
        acidKey === k ? "acid" : ""));
    });
    filtersEl.appendChild(wrap);
  };
  // タキソノミー順（登録のあるものだけ）
  const typeOrder = ["中和", "沈殿", "気体発生", "酸化還元", "錯イオン生成", "分子反応"];
  makeGroup("反応の型", typeOrder.filter((k) => lib.byType[k]), sel.type, (k) => lib.byType[k].length, null);
  const saltOrder = ["正塩", "酸性塩", "塩基性塩"];
  makeGroup("塩の分類", saltOrder.filter((k) => lib.bySalt[k]), sel.salt, (k) => lib.bySalt[k].length, "酸性塩");
  const diffs = [...new Set(lib.reactions.map((r) => r.difficulty))].sort((a, b) => a - b);
  makeGroup("難易度", diffs, sel.difficulty,
    (d) => lib.reactions.filter((r) => r.difficulty === d).length, null, (d) => "★".repeat(d));
  const units = Object.keys(lib.byUnit).sort((a, b) => lib.byUnit[b].length - lib.byUnit[a].length);
  makeGroup("単元", units, sel.unit, (k) => lib.byUnit[k].length, null);
}

function matches(rx) {
  if (sel.type.size && !sel.type.has(rx.classes.type)) return false;
  if (sel.salt.size && !(rx.classes.saltType && sel.salt.has(rx.classes.saltType))) return false;
  if (sel.difficulty.size && !sel.difficulty.has(rx.difficulty)) return false;
  if (sel.unit.size && !((rx.units || []).some((u) => sel.unit.has(u)))) return false;
  if (!matchesQuery(rx, query)) return false;
  return true;
}

function badge(text, cls) {
  const s = document.createElement("span");
  s.className = "rxnBadge" + (cls ? " " + cls : "");
  s.textContent = text;
  return s;
}

function render() {
  buildFilters();
  const rows = lib.reactions.filter(matches);
  countEl.textContent = `${rows.length} 件 / 全 ${lib.reactions.length} 件`;
  listEl.innerHTML = "";
  for (const rx of rows) {
    const li = document.createElement("li");
    li.className = "rxnRow";

    const eq = document.createElement("div");
    eq.className = "rxnEq";
    eq.textContent = formatEquation(rx, disp);
    li.appendChild(eq);

    const meta = document.createElement("div");
    meta.className = "rxnMeta";
    meta.appendChild(badge(rx.classes.type));
    if (rx.classes.saltType) meta.appendChild(badge(rx.classes.saltType, rx.classes.saltType === "酸性塩" ? "acid" : ""));
    if (rx.classes.redox) meta.appendChild(badge(rx.classes.redox, "redox"));
    meta.appendChild(badge("難易度 " + "★".repeat(rx.difficulty), "diff"));
    if (rx.netIonic) {
      const net = document.createElement("span");
      net.className = "rxnNet";
      net.textContent = "イオン反応式: " + rx.netIonic;
      meta.appendChild(net);
    }
    li.appendChild(meta);

    if (rx.note) {
      const note = document.createElement("div");
      note.className = "rxnNote";
      note.textContent = rx.note;
      li.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "rxnActions";
    if (rx.playable) {
      const a = document.createElement("a");
      a.className = "rxnPlay";
      // 酸化還元モードのステージは redox.html、それ以外はパズル本体（index.html）へ
      if (rx.redoxStage) {
        a.href = "redox.html?rxn=" + encodeURIComponent(rx.redoxStage);
        a.textContent = "▶ 酸化還元モードで見る";
      } else {
        a.href = "index.html?rxn=" + encodeURIComponent(rx.id);
        a.textContent = "▶ このパズルを遊ぶ";
      }
      actions.appendChild(a);
    } else {
      actions.appendChild(badge("準備中（参照のみ）", "pending"));
    }
    li.appendChild(actions);

    listEl.appendChild(li);
  }
  if (!rows.length) {
    const li = document.createElement("li");
    li.className = "rxnEmpty";
    li.textContent = "該当する反応がありません。検索語や絞り込みを変えてみてください。";
    listEl.appendChild(li);
  }
}

searchEl.addEventListener("input", () => { query = searchEl.value.trim(); render(); });

loadReactionLibrary().then((l) => { lib = l; render(); }).catch((e) => {
  countEl.textContent = "反応データの読み込みに失敗しました（ローカルサーバー経由で開いてください）: " + e.message;
});

})();
