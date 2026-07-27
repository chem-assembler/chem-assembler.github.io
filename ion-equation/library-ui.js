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

/* 相手の反応へ飛ぶ。絞り込みを外して確実に見える状態にしてから、その行を目立たせる */
function jumpTo(id) {
  Object.values(sel).forEach((s) => s.clear());
  query = "";
  if (searchEl) searchEl.value = "";
  render();
  const row = document.getElementById("rxn-" + id);
  if (!row) return;
  row.scrollIntoView({ block: "center" });
  row.classList.add("jumped");
  setTimeout(() => row.classList.remove("jumped"), 1600);
}

function render() {
  buildFilters();
  const rows = lib.reactions.filter(matches);
  countEl.textContent = `${rows.length} 件 / 全 ${lib.reactions.length} 件`;
  listEl.innerHTML = "";
  for (const rx of rows) {
    const li = document.createElement("li");
    li.className = "rxnRow";
    li.id = "rxn-" + rx.id;

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

    // 同じ反応を「2本に分けて書く／まとめて1本で書く」の行き来。
    // 絞り込みで相手が隠れていることがあるので、飛ぶ前にフィルタを外してから探す
    const linkRow = document.createElement("div");
    linkRow.className = "rxnLinks";
    const linkTo = (id, label) => {
      const other = lib.byId[id];
      if (!other) return;
      const b = document.createElement("button");
      b.className = "rxnLink";
      b.textContent = `${label} ${formatEquation(other, disp)}`;
      b.onclick = () => jumpTo(id);
      linkRow.appendChild(b);
    };
    (rx.steps || []).forEach((sid, i) => linkTo(sid, `▸ 2本に分けて書くと（${i + 1}）`));
    if (rx.combined) linkTo(rx.combined, "▸ まとめて1本で書くと");
    // 同じ結果を別の試薬で起こす版（NaOH ⇄ アンモニア水）。イオン反応式で見ると同じ反応
    if (rx.variantOf) linkTo(rx.variantOf, "▸ 別の試薬でも同じ沈殿ができる");
    if (linkRow.childElementCount) li.appendChild(linkRow);

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
