"use strict";
/* portal.js — 単元から入る入り口ページ。

   反応IDの一覧が平らに並んでいるだけだと「いまどの科目のどの単元をやっているのか」が
   分からない。ここは科目 → 単元 → ステージ の順に並べ替えて見せるだけのページで、
   単元の定義（CURRICULUM）と所属の解決（stagesOfUnit）は model.js が持つ。
   ステージを足しても、タグさえ付けておけばこのページは勝手に増える。 */
(() => {

const MODE_INFO = {
  ion:       { href: "index.html",     label: "イオン反応", param: "rxn" },
  redox:     { href: "redox.html",     label: "酸化還元",   param: "rxn" },
  condition: { href: "condition.html", label: "液性",       param: "s" },
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

/* #単元id で来たときに、その単元が見出しごと見える位置に止まり、
   どこに着地したのかが分かるようにする。
   ブラウザ任せのアンカー移動は**中身を作る前に**一度走ってしまう（単元の区画はここで
   組み立てるので、その時点ではまだ存在しない）ので、組み立て終わってから自分でやり直す。 */
function landOnHash() {
  document.querySelectorAll(".unitBox.landed").forEach((b) => b.classList.remove("landed"));
  const id = decodeURIComponent(location.hash.replace(/^#/, ""));
  if (!id) return;
  const box = document.getElementById(id);
  if (!box || !box.classList.contains("unitBox")) return;
  box.classList.add("landed");
  box.scrollIntoView({ block: "start" });
}

buildRoles();
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
      landed: (document.querySelector(".unitBox.landed") || {}).id || "",
    };
  },
};

})();
