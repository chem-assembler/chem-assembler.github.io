"use strict";
/* portal.js — 単元から入る入り口ページ。

   反応IDの一覧が平らに並んでいるだけだと「いまどの科目のどの単元をやっているのか」が
   分からない。ここは科目 → 単元 → ステージ の順に並べ替えて見せるだけのページで、
   単元の定義（CURRICULUM）と所属の解決（stagesOfUnit）は model.js が持つ。
   ステージを足しても、タグさえ付けておけばこのページは勝手に増える。 */
(() => {

/* ⚠ **どの画面へどう送るかは、このページの内部知識**（model.js は URL を知らない）。
   param が null のモードは、ステージを名指しできないのでモードのページまでしか送れない。 */
const MODE_INFO = {
  ion:       { href: "index.html",     label: "イオン反応", param: "rxn" },
  redox:     { href: "redox.html",     label: "酸化還元",   param: "rxn" },
  condition: { href: "condition.html", label: "液性",       param: "s" },
  // ⚠ battery.js は URL パラメータを見ていない（app.js の ?rxn=・condition.js の ?s= に当たるものが無い）。
  // 直接リンクは別レーンの領分なので、当面はモードのページへ送り、番号は札で示す
  cell:      { href: "battery.html",   label: "電池",       param: null },
};

/* 【R】難度の札。⚠ **redox.js の ORGANIC_TAG と1文字も違えないこと。**
   redox.js は別レーンが作業中なので参照しに行かず、同じ文字列をここにも持ち、
   **両者が一致することを回帰テストが見張る**（片方だけ直したら赤くなる）。 */
const ORGANIC_TAG = "有機（発展）";

/* 名指しできないモードにだけ添える案内。行き先が「ステージ」でなく「モード」になる理由を出す */
const MODE_HINT = {
  cell: "電池モードはステージを直接ひらけません。開いたあと、帯の番号を押してください。",
};

/* やりたいことから入るカード。単元横断で「このアプリの役割」を3つ＋2つに畳んで見せる */
const ROLES = [
  { icon: "⚗️", title: "中和と弱酸の遊離の仕組み",
    body: "水の中でイオンがどう組み変わるかを見ながら、反応式の係数を自分で決める。",
    href: "index.html", cta: "イオン反応モードへ" },
  { icon: "🎓", title: "酸化還元反応の組み立て",
    body: "半反応式を部品として、e⁻ の数をそろえて足し合わせ、化学反応式まで筆算で戻す。",
    href: "redox.html", cta: "酸化還元モードへ" },
  { icon: "🧪", title: "無機の沈殿と錯イオン形成",
    body: "溶けない組み合わせは沈殿に、配位子が囲めば錯イオンに。枠の形で状態を見分ける。",
    href: "index.html?rxn=complex-cu-nh3", cta: "沈殿・錯イオンのステージへ" },
  { icon: "🔋", title: "電池・電気分解をつくる",
    body: "2枚の金属板をつなぐと、どちらが溶けるか。e⁻ が導線を流れるようすを見ながら、電池の式を組み立てる。",
    href: "battery.html", cta: "電池モードへ" },
  { icon: "⚗️", title: "酸化剤と還元剤を自分で選ぶ",
    body: "選んだ組み合わせが反応するかどうかを、順位表から確かめる。反応しないときは理由が出る。",
    href: "redox.html?free=1", cta: "自由に組み合わせるへ" },
  { icon: "🔢", title: "酸化数を決める",
    body: "K₂Cr₂O₇ の Cr をいきなり考えない。まずイオンに分け、そのイオンの中で「合計＝電荷」から出す。",
    href: "oxidation.html", cta: "酸化数モードへ" },
  { icon: "⚖️", title: "液性で書き換える（酸性 ⇄ 塩基性）",
    body: "同じ酸化還元でも液性で式が変わる。両辺に OH⁻ を足して導けることを確かめる。",
    href: "condition.html", cta: "液性モードへ", sub: true },
  { icon: "🔎", title: "反応インデックス（辞書引き）",
    body: "物質名や分類から反応をさがし、その場でシミュレーターを開く。",
    href: "library.html", cta: "反応インデックスへ", sub: true },
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildRoles() {
  const wrap = document.getElementById("roleCards");
  for (const r of ROLES) {
    const a = document.createElement("a");
    a.className = "roleCard" + (r.sub ? " sub" : "");
    a.href = r.href;
    const h = el("div", "roleHead");
    h.append(el("span", "roleIcon", r.icon), el("span", "roleTitle", r.title));
    a.append(h, el("p", "roleBody", r.body), el("span", "roleCta", r.cta + " →"));
    wrap.appendChild(a);
  }
}

function buildCurriculum() {
  const wrap = document.getElementById("curriculum");
  for (const sub of CURRICULUM) {
    const sec = el("section", "subject");
    sec.appendChild(el("h3", "subjectName", sub.subject));
    for (const unit of sub.units) {
      const stages = stagesOfUnit(unit);
      if (!stages.length) continue;
      const box = el("div", "unitBox");
      /* 単元 id をそのままアンカーにする（ハブの単元表から portal.html#u-gas で着地できる）。
         **相手に渡すのは単元の id だけ**で、そこからどのステージへ送るかは このページが決める
         ＝ 収録先を変えても相手側は直さなくてよい（リポジトリの依存の取り決め）。 */
      box.id = unit.id;
      const head = el("div", "unitHead");
      head.append(el("span", "unitName", unit.name), el("span", "unitCount", `${stages.length}件`));
      box.appendChild(head);
      if (unit.note) box.appendChild(el("p", "unitNote", unit.note));
      const list = el("div", "stageChips");
      for (const st of stages) {
        const info = MODE_INFO[st.mode];
        const a = document.createElement("a");
        a.className = "stageChip mode-" + st.mode;
        a.href = `${info.href}${info.href.includes("?") ? "&" : "?"}${info.param}=${encodeURIComponent(st.id)}`;
        a.append(el("span", "chipMode", info.label), el("span", "chipTitle", st.title));
        list.appendChild(a);
      }
      box.appendChild(list);
      sec.appendChild(box);
    }
    wrap.appendChild(sec);
  }
}

/* 【R】系列の索引。DESIGN_stage_series.md

   ⚠ 索引の**ページは新設していない**。すでに単元の入り口があるこのページに区画を1つ足している
   （3つ目の索引を作らない、という発注書の制約）。系列と単元は役割が違う:
     系列 … **重ならない**分け方。1ステージ＝1系列。62ステージ全部（電池・電気分解も入る）
     単元 … **重なる**分類。s8 は中和の単元にも沈殿の単元にも出る
   ⚠ 並べ替えない。番号（アプリの帯と同じ通し番号）をそのまま出す。
   ⚠ 系列（区画）と難度（札）は**別の軸**なので、両方が同時に見える形にする。 */
function buildSeriesIndex() {
  const wrap = document.getElementById("seriesIndex");
  const { groups, unclassified } = stagesBySeries();
  for (const g of groups) {
    const box = el("div", "seriesBox");
    // 系列 id をそのままアンカーにする（単元と同じ流儀。portal.html#sr-precipitate で着地できる）
    box.id = g.series.id;
    const head = el("div", "seriesHead");
    head.append(el("span", "seriesName", g.series.name), el("span", "seriesCount", `${g.stages.length}件`));
    box.append(head, el("p", "seriesNote", g.series.note));
    const hints = new Set();
    const list = el("div", "seriesChips");
    for (const s of g.stages) {
      const info = MODE_INFO[s.mode];
      const a = document.createElement("a");
      a.className = "seriesChip mode-" + s.mode;
      a.href = info.param
        ? `${info.href}?${info.param}=${encodeURIComponent(s.id)}`
        : info.href;
      // 番号 → モード → ステージ名 の順。番号とステージ名が並ぶ場所は今までどこにも無かった
      a.append(el("span", "chipNo", String(s.no)), el("span", "chipMode", info.label),
               el("span", "chipTitle", s.title));
      // 難度は札。**系列からは抜かない**（有機の酸化は酸化還元そのもの）
      if (typeof isOrganicStage === "function" && isOrganicStage(s.stage)) {
        a.appendChild(el("span", "chipLevel", ORGANIC_TAG));
      }
      if (!info.param && MODE_HINT[s.mode]) hints.add(MODE_HINT[s.mode]);
      list.appendChild(a);
    }
    box.appendChild(list);
    for (const h of hints) box.appendChild(el("p", "seriesHint", h));
    wrap.appendChild(box);
  }
  /* ⚠ どこにも入らなかったステージは**隠さずに出す**。
     黙って消えるのがいちばん怖い事故で、回帰テストもここが0件であることを見張っている。 */
  if (unclassified.length) {
    const box = el("div", "seriesBox seriesUnclassified");
    box.append(el("div", "seriesHead", "系列が決まっていないステージ"),
               el("p", "seriesNote", unclassified.map((s) => s.mode + s.no + "：" + s.title).join(" / ")));
    wrap.appendChild(box);
  }
}

/* #単元id で来たときに、その単元が見出しごと見える位置に止まり、
   どこに着地したのかが分かるようにする。
   ブラウザ任せのアンカー移動は**中身を作る前に**一度走ってしまう（単元の区画はここで
   組み立てるので、その時点ではまだ存在しない）ので、組み立て終わってから自分でやり直す。 */
function landOnHash() {
  document.querySelectorAll(".landed").forEach((b) => b.classList.remove("landed"));
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!id) return;
  const box = document.getElementById(id);
  // 単元と同じしくみを系列にも効かせる（portal.html#sr-precipitate で着地できる）
  if (!box || !(box.classList.contains("unitBox") || box.classList.contains("seriesBox"))) return;
  box.classList.add("landed");
  box.scrollIntoView({ block: "start" });
}

buildRoles();
buildSeriesIndex();
buildCurriculum();
landOnHash();
window.addEventListener("hashchange", landOnHash);

/* テスト用フック */
window.Portal = {
  state() {
    const links = [...document.querySelectorAll(".stageChip")].map((a) => a.getAttribute("href"));
    return {
      roles: document.querySelectorAll(".roleCard").length,
      subjects: document.querySelectorAll(".subject").length,
      units: document.querySelectorAll(".unitBox").length,
      chips: links.length,
      links,
      // 単元アンカー（外から portal.html#<id> で名指しできる id の一覧）
      unitAnchors: [...document.querySelectorAll(".unitBox")].map((b) => b.id),
      landed: (document.querySelector(".unitBox.landed, .seriesBox.landed") || {}).id || "",
    };
  },
  /* 【R】系列の索引。単元のチップ（.stageChip）とは別のクラスにしてあるので、
     上の links / chips には混ざらない（既存の検査の意味を変えないため） */
  seriesState() {
    const boxes = [...document.querySelectorAll(".seriesBox")];
    return {
      boxes: boxes.length,
      anchors: boxes.map((b) => b.id),
      unclassified: document.querySelectorAll(".seriesUnclassified").length,
      groups: boxes.map((b) => ({
        id: b.id,
        name: (b.querySelector(".seriesName") || {}).textContent || "",
        count: b.querySelectorAll(".seriesChip").length,
        hints: b.querySelectorAll(".seriesHint").length,
      })),
      chips: [...document.querySelectorAll(".seriesChip")].map((a) => ({
        no: a.querySelector(".chipNo").textContent,
        mode: a.querySelector(".chipMode").textContent,
        title: a.querySelector(".chipTitle").textContent,
        level: (a.querySelector(".chipLevel") || {}).textContent || "",
        href: a.getAttribute("href"),
      })),
    };
  },
};

})();
