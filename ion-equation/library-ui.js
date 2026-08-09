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
/* 「その反応の実装が実在するか」を引く索引（model.js の STAGES / REDOX_STAGES から作る）。
   遊べるかどうかは手書きの真偽値ではなく、これと animationType レジストリから導出する
   （library.js の resolvePlayback）。ステージの増減に索引が自動で追従する。 */
const stageIds = stageIndex(
  typeof STAGES !== "undefined" ? STAGES : [],
  typeof REDOX_STAGES !== "undefined" ? REDOX_STAGES : []);
/* 隣のアプリ（比例式でみる化学計算）で同じ式の量的計算ができる反応の対応表。
   ratio/model.js が読めていれば埋まり、読めなければ空のまま（機能が静かに消えるだけ） */
let cross = {};
const sel = { type: new Set(), salt: new Set(), difficulty: new Set(), unit: new Set() };
let onlyCross = false;
let query = "";
/* 隣のアプリ（比例式でみる化学計算）から ?from=<問題ID> で来たときの相手。
   { ratioId, ionId|null, no } を入れる。ionId が null なら「まだ収録されていない式」 */
let from = null;

function chip(label, active, onClick, extraClass) {
  const b = document.createElement("button");
  b.className = "filterChip" + (active ? " on" : "") + (extraClass ? " " + extraClass : "");
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

/* いま何か絞り込みが掛かっているか（チップ・横断・検索語のどれか） */
function anyFilter() {
  return Object.values(sel).some((s) => s.size) || onlyCross || query !== "";
}

/* 絞り込みを全部外す。「すべて表示」ボタンと、相手の反応へ飛ぶ jumpTo() が同じことをするので
   1か所に持つ（2か所に書くと、チップの種類を増やしたとき片方だけ直し忘れる）。
   render() は呼ばない——呼び出し側がこのあと何をするか（描き直すだけか、飛ぶか）を決める。 */
function clearFilters() {
  Object.values(sel).forEach((s) => s.clear());
  onlyCross = false;
  query = "";
  if (searchEl) searchEl.value = "";
}

function buildFilters() {
  filtersEl.innerHTML = "";
  /* 全解除（docs/review_others.md 項目4）。選んだチップを1つずつ押し直すしかなかった。
     何も掛かっていないときは押しても何も起きないので、そもそも出さない */
  if (anyFilter()) {
    const wrap = document.createElement("div");
    wrap.className = "filterGroup";
    wrap.appendChild(chip(`✕ 絞り込みを解除（全 ${lib.reactions.length} 件）`, false,
      () => { clearFilters(); render(); }, "clearAll"));
    wrap.id = "libClearWrap";
    filtersEl.appendChild(wrap);
  }
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
  // アプリ横断: 量的計算までつながる反応だけに絞る
  const nCross = Object.keys(cross).length;
  if (nCross) {
    const wrap = document.createElement("div");
    wrap.className = "filterGroup";
    const lead = document.createElement("span");
    lead.className = "filterLead";
    lead.textContent = "ほかのアプリ";
    wrap.appendChild(lead);
    wrap.appendChild(chip(`⚖️ 量的計算もできる（${nCross}）`, onlyCross,
      () => { onlyCross = !onlyCross; render(); }, "cross"));
    filtersEl.appendChild(wrap);
  }
}

function matches(rx) {
  if (sel.type.size && !sel.type.has(rx.classes.type)) return false;
  if (sel.salt.size && !(rx.classes.saltType && sel.salt.has(rx.classes.saltType))) return false;
  if (sel.difficulty.size && !sel.difficulty.has(rx.difficulty)) return false;
  if (sel.unit.size && !((rx.units || []).some((u) => sel.unit.has(u)))) return false;
  if (onlyCross && !cross[rx.id]) return false;
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
  clearFilters();
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
    // 係数だけ別の要素にして色を変える（40件が縦に並ぶので、係数比が目に入るかで見比べやすさが変わる）
    renderEquation(eq, rx, disp);
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
    /* 上の3つは関係の種類ごとにラベルを決め打ちしている。related は**ラベルをデータ側が持つ**
       汎用のつながりで、決め打ちが合わない関係（三段中和の段どうしなど）に使う。
       種類が増えるたびに if を1本足すのをやめるための受け皿 */
    (rx.related || []).forEach((r) => linkTo(r.id, r.label));
    if (linkRow.childElementCount) li.appendChild(linkRow);

    const actions = document.createElement("div");
    actions.className = "rxnActions";
    // 遊べるか・どこへ送るかは animationType レジストリ＋ステージの実在から導出する。
    // 手書きの真偽値を持たないので、ステージを消した／id を変えた反応は自動で「準備中」に戻る
    const play = resolvePlayback(rx, stageIds);
    if (play.playable) {
      const a = document.createElement("a");
      a.className = "rxnPlay";
      a.href = play.href;
      a.textContent = play.label;
      actions.appendChild(a);
    } else {
      actions.appendChild(badge("準備中（参照のみ）", "pending"));
    }
    // アプリ横断のリンク。同じ式のまま「量は何gか」へ進める
    if (cross[rx.id]) {
      const b = document.createElement("a");
      b.className = "rxnPlay cross";
      b.href = "../ratio/stoich.html?r=" + encodeURIComponent(cross[rx.id]);
      b.textContent = "⚖️ この式で量的計算をする";
      b.title = "比例式でみる化学計算（別アプリ）の同じ反応式の問題を開く";
      actions.appendChild(b);
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

/* 隣のアプリからの来訪を解決する。
   相手の問題 ID → その式 → 正準形 → 同じ正準形の反応、の順にたどる。
   **ID の対応表を逆引きしない**: cross は式ごとに最初の問題だけを持つので、
   同じ式の2問目以降（メタンの燃焼など）が引けない。式で照合すれば全問solvableになる。 */
function resolveFrom() {
  const id = new URLSearchParams(location.search).get("from");
  if (!id || typeof ChemRatio === "undefined" || !ChemRatio.REACTIONS) return null;
  const idx = ChemRatio.REACTIONS.findIndex((p) => p.id === id);
  if (idx < 0) return null;
  const p = ChemRatio.REACTIONS[idx];
  const formulaOf = (key) => {
    const sub = ChemRatio.SUBSTANCES[key];
    return (sub && sub.formula) ? sub.formula.replace(/<\/?sub>/g, "") : key;
  };
  const L = p.eq.filter((t) => !t.product), R = p.eq.filter((t) => t.product);
  const key = canonicalEquation(
    L.map((t) => formulaOf(t.sub)), R.map((t) => formulaOf(t.sub)),
    L.map((t) => t.coef).concat(R.map((t) => t.coef)));
  const hit = (lib.reactions || []).find((rx) =>
    canonicalEquation(rx.reactants, rx.products, rx.coeffs) === key);
  return { ratioId: id, no: idx + 1, ionId: hit ? hit.id : null };
}

/* 来た道を示して戻れるようにする（横断が片道だと辞書引きの流れが途切れる）。
   収録されていない式なら、そう正直に言う（リンクは常に張られてくるので） */
function renderFrom() {
  const box = document.getElementById("libFrom");
  if (!box) return;
  if (!from) { box.hidden = true; return; }
  box.hidden = false;
  const back = '<a class="fromBack" href="../ratio/stoich.html?r=' +
    encodeURIComponent(from.ratioId) + '">← 問題へ戻る</a>';
  box.innerHTML = from.ionId
    ? '<span class="fromWhere">比例式でみる化学計算の<b>問' + from.no +
      '</b>から来ました。同じ式を下で強調しています</span>' + back
    : '<span class="fromWhere fromMiss">比例式でみる化学計算の<b>問' + from.no +
      '</b>から来ました。<b>この式はまだ収録されていません</b>（下は索引の全体です）</span>' + back;
}

loadReactionLibrary().then((l) => {
  lib = l;
  // 隣のアプリのデータが読めていれば、式そのものを突き合わせて対応表を作る
  if (typeof ChemRatio !== "undefined" && ChemRatio.REACTIONS) {
    cross = buildCrossAppIndex(lib.reactions, ChemRatio.REACTIONS, ChemRatio.SUBSTANCES);
  }
  from = resolveFrom();
  renderFrom();
  render();
  if (from && from.ionId) {
    const row = document.getElementById("rxn-" + from.ionId);
    if (row) {
      row.classList.add("fromHit");
      row.scrollIntoView({ block: "center" });
    }
  }
}).catch((e) => {
  countEl.textContent = "反応データの読み込みに失敗しました（ローカルサーバー経由で開いてください）: " + e.message;
});

/* テスト用フック */
window.IonLibUI = {
  state() {
    return {
      cross: Object.assign({}, cross),
      from: from && Object.assign({}, from),
      onlyCross,
      query,
      selected: Object.fromEntries(Object.entries(sel).map(([k, s]) => [k, [...s]])),
      anyFilter: anyFilter(),
      total: lib ? lib.reactions.length : 0,
      rows: document.querySelectorAll("#libList .rxnRow").length,
      hasClearBtn: !!document.querySelector(".filterChip.clearAll"),
      crossLinks: [...document.querySelectorAll(".rxnPlay.cross")].map((a) => a.getAttribute("href")),
      /* 「▶遊ぶ」と「準備中」の内訳。導出に切り替えても画面の見え方が変わっていないことを
         テストが実測するための窓（DOM を数える＝ロジックの再計算ではない） */
      playLinks: [...document.querySelectorAll(".rxnPlay:not(.cross)")].map((a) => a.getAttribute("href")),
      pendingCount: document.querySelectorAll(".rxnBadge.pending").length,
    };
  },
  toggleCrossFilter() {
    onlyCross = !onlyCross;
    render();
  },
  /* テストから絞り込みを掛けるための入口（画面のチップを押すのと同じ状態にする） */
  setFilter(kind, value) {
    sel[kind].add(value);
    render();
  },
  setQuery(q) {
    query = q;
    if (searchEl) searchEl.value = q;
    render();
  },
};

})();
