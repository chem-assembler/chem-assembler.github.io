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
  /* B3-2（2026-09-07）で電池と電気分解を2枚に割り、cell.js に ?s= の受け口を足したので、
     どちらもステージを名指しできるようになった（それまでは param: null で、
     「開いたあと帯の番号を押してください」という但し書きを添えていた）。 */
  cell:      { href: "battery.html",       label: "電池",     param: "s" },
  elyz:      { href: "electrolysis.html",  label: "電気分解", param: "s" },
};

/* 【R】難度の札。⚠ **redox.js の ORGANIC_TAG と1文字も違えないこと。**
   redox.js は別レーンが作業中なので参照しに行かず、同じ文字列をここにも持ち、
   **両者が一致することを回帰テストが見張る**（片方だけ直したら赤くなる）。 */
const ORGANIC_TAG = "有機（発展）";

/* 名指しできないモードにだけ添える案内。行き先が「ステージ」でなく「モード」になる理由を出す。
   ⚠ **いまは空**。B3-2 で電池・電気分解にも ?s= の受け口ができ、名指しできないモードが
   1つも無くなった。表そのものは残す（次に名指しできないモードが来たときの置き場所）。 */
const MODE_HINT = {};

/* ================================================================================
   やりたいことから入るカード（DESIGN_battery_electrolysis.md §11）

   ★ **単元の順に並べる**（2026-09-07・ユーザーの決定）。
   以前は9枚が思いついた順に平らに並んでいて、「いま自分がやっている単元のものはどれか」が
   カードの並びからは読めなかった。3つの単元に束ね、単元の中は学ぶ順に置く。

   ★ ③（酸化還元）の中は **部品 → 組み立て → 応用**。
     部品 … 酸化数・半反応式・液性（式そのものを作れるようにする道具）
     組み立て … 組み立てモード・自分で選ぶ（部品を組んで1本の式にする）
     応用 … 電池・電気分解（組んだ式を装置の中で動かす）

   ★ **中和は①と②の両方に出す**（ユーザーの決定「両方にあってもよい」）。
     ただし同じ札を2枚並べない —— 着目点が違うことを札の題と文で言い分ける。
     ユーザーの言葉:「BaSO4 は出題の仕方による／Ba(OH)2 と H2SO4 の中和に着目するなら酸塩基／
     BaSO4 の生成に着目するなら沈殿」。同じ反応が2つの単元に出るのは、
     下の「単元から入る」（CURRICULUM ＝ 重なる分類）がもともとやっていることで、
     ここでもそれを見せる、というだけ。 */
const ROLE_UNITS = [
  {
    id: "ru-coeff", name: "① 化学反応式の係数合わせ",
    note: "「何と何ができるか」が分かっている反応で、個数がちょうど合う比をさがす。",
    roles: [
      { icon: "🧪", title: "無機の沈殿と錯イオン形成",
        body: "溶けない組み合わせは沈殿に、配位子が囲めば錯イオンに。枠の形で状態を見分ける。",
        href: "index.html?rxn=complex-cu-nh3", cta: "沈殿・錯イオンのステージへ" },
      /* ②にもある中和。**こちらは「BaSO₄ ができること」に着目した面**なので、
         行き先も硫酸 × 水酸化バリウム（s8）のステージそのものにする */
      { icon: "⚗️", title: "中和で沈殿ができる式",
        body: "硫酸と水酸化バリウム。中和と沈殿が同時に起きるので、BaSO₄ ができることに着目すると係数合わせの問題になる。同じ反応を「中和の仕組み」として見るなら②へ。",
        href: "index.html?rxn=s8", cta: "硫酸 × 水酸化バリウムへ" },
    ],
  },
  {
    id: "ru-acidbase", name: "② 酸と塩基",
    note: "H⁺ と OH⁻ が結びついて水になる。弱酸は分子のまま溶け、必要なぶんだけ電離して補う。",
    roles: [
      { icon: "⚗️", title: "中和と弱酸の遊離の仕組み",
        body: "水の中でイオンがどう組み変わるかを見ながら、反応式の係数を自分で決める。",
        href: "index.html", cta: "イオン反応モードへ" },
    ],
  },
  {
    id: "ru-redox", name: "③ 酸化還元",
    note: "e⁻ の受け渡し。部品（酸化数・半反応式・液性）→ 組み立て → 応用（電池・電気分解）の順。",
    roles: [
      { icon: "🔢", title: "酸化数を決める",
        body: "K₂Cr₂O₇ の Cr をいきなり考えない。まずイオンに分け、そのイオンの中で「合計＝電荷」から出す。",
        href: "oxidation.html", cta: "酸化数モードへ" },
      { icon: "⚡", title: "半反応式を組む",
        body: "反応の前と後だけを与える。H₂O・H⁺・e⁻ を自分で入れて式にする。手順は2通り選べる。",
        href: "halfreaction.html", cta: "半反応式モードへ" },
      { icon: "⚖️", title: "液性で書き換える（酸性 ⇄ 塩基性）",
        body: "同じ酸化還元でも液性で式が変わる。両辺に OH⁻ を足して導けることを確かめる。",
        href: "condition.html", cta: "液性モードへ" },
      { icon: "🎓", title: "酸化還元反応の組み立て",
        body: "半反応式を部品として、e⁻ の数をそろえて足し合わせ、化学反応式まで筆算で戻す。",
        href: "redox.html", cta: "酸化還元モードへ" },
      { icon: "⚗️", title: "酸化剤と還元剤を自分で選ぶ",
        body: "選んだ組み合わせが反応するかどうかを、順位表から確かめる。反応しないときは理由が出る。",
        href: "redox.html?free=1", cta: "自由に組み合わせるへ" },
      { icon: "🔋", title: "電池をつくる",
        body: "2枚の金属板をつなぐと、どちらが溶けるか。e⁻ が導線を流れるようすを見ながら、電池の式を組み立てる。",
        href: "battery.html", cta: "電池モードへ" },
      /* B3-2 で電池から割り出した面。**電池と対にして応用の最後に置く**
         （e⁻ を取り出す ⇄ e⁻ を押し込む） */
      { icon: "⚡", title: "電気分解をする",
        body: "電極に来たイオンが、そのまま反応するとはかぎらない。まず何が反応するかを選び、順位表で確かめてから式を組み立てる。",
        href: "electrolysis.html", cta: "電気分解モードへ" },
    ],
  },
  {
    id: "ru-find", name: "単元をまたいで使う",
    note: "",
    roles: [
      { icon: "🔎", title: "反応インデックス（辞書引き）",
        body: "物質名や分類から反応をさがし、その場でシミュレーターを開く。",
        href: "library.html", cta: "反応インデックスへ", sub: true },
    ],
  },
];

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function buildRoles() {
  const wrap = document.getElementById("roleCards");
  for (const u of ROLE_UNITS) {
    const sec = el("section", "roleUnit");
    sec.id = u.id;
    sec.appendChild(el("h3", "roleUnitName", u.name));
    if (u.note) sec.appendChild(el("p", "roleUnitNote", u.note));
    const grid = el("div", "roleCards");
    for (const r of u.roles) {
      const a = document.createElement("a");
      a.className = "roleCard" + (r.sub ? " sub" : "");
      a.href = r.href;
      const h = el("div", "roleHead");
      h.append(el("span", "roleIcon", r.icon), el("span", "roleTitle", r.title));
      a.append(h, el("p", "roleBody", r.body), el("span", "roleCta", r.cta + " →"));
      grid.appendChild(a);
    }
    sec.appendChild(grid);
    wrap.appendChild(sec);
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
      /* 単元ごとの束（§11）。並びと中身が単元順になっていることを回帰テストが見る */
      roleUnits: [...document.querySelectorAll(".roleUnit")].map((s) => ({
        id: s.id,
        name: (s.querySelector(".roleUnitName") || {}).textContent || "",
        titles: [...s.querySelectorAll(".roleTitle")].map((t) => t.textContent),
        hrefs: [...s.querySelectorAll(".roleCard")].map((a) => a.getAttribute("href")),
      })),
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
