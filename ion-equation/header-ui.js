"use strict";
/* header-ui.js — ヘッダーの「横スクロールする帯」の共通挙動（全ページで読む）。

   ステージは index で30個あり、折り返して並べると 375px 幅ではそれだけで5段・200px、
   ヘッダー全体でファーストビューの40%（実測 324px）を占めていた（docs/review_others.md 項目3）。
   style.css 側で帯（.hscroll > .strip）を1行の横スクロールにしたので、次の3つをここで面倒みる:
     (a) 横に続きがあること自体に気づけない → 続きがある側にだけ端の影と矢印を出す
     (b) いま開いているステージが帯の外にいることがある → 帯の中で中央に寄せる
     (c) 全部で何個あって今どれを開いているのか → はみ出しているときだけ「7/30」を添える

   ここは見た目だけを扱う。化学の判断もステージの中身も一切持たない
   （「.strip の中に子要素が並ぶ」「開いているものに .active が付く」という DOM の約束だけに依存）。 */
(() => {
  const bars = [...document.querySelectorAll("header .hscroll")].map((wrap) => {
    const strip = wrap.querySelector(".strip");
    const holder = wrap.parentElement;
    return { wrap, strip, count: holder && holder.querySelector(".navCount") };
  }).filter((b) => b.strip);
  if (!bars.length) return;

  function update(b) {
    const slack = b.strip.scrollWidth - b.strip.clientWidth;
    const over = slack > 1;
    b.wrap.classList.toggle("moreLeft", over && b.strip.scrollLeft > 1);
    b.wrap.classList.toggle("moreRight", over && b.strip.scrollLeft < slack - 1);
    if (b.count) {
      const items = [...b.strip.children];
      const i = items.findIndex((el) => el.classList.contains("active"));
      b.count.textContent = (i + 1) + "/" + items.length;
      b.count.hidden = !over || !items.length;
    }
  }

  /* 開いているものを帯の中央へ寄せる。
     scrollIntoView はページ本体まで動かしてしまうので、帯の scrollLeft を自分で決める。 */
  function showActive(b) {
    const el = b.strip.querySelector(".active");
    if (el) b.strip.scrollLeft = el.offsetLeft - (b.strip.clientWidth - el.offsetWidth) / 2;
    update(b);
  }

  for (const b of bars) {
    b.strip.addEventListener("scroll", () => update(b), { passive: true });
    // 各モードの buildStageNav() が中身を作り直すたびに追従する（呼び出し側に手を入れない）
    new MutationObserver(() => showActive(b)).observe(b.strip, { childList: true });
    showActive(b);
  }
  window.addEventListener("resize", () => bars.forEach(update));

  /* テスト・監査用フック */
  const stage = bars.find((b) => b.strip.id === "stageNav");
  window.IonHeader = {
    refresh: () => bars.forEach(showActive),
    state: () => ({
      headerHeight: Math.round(document.querySelector("header").getBoundingClientRect().height),
      bars: bars.map((b) => ({
        id: b.strip.id || b.strip.className,
        items: b.strip.children.length,
        // 折り返していないこと ＝ 帯の高さが中身1個ぶんに収まっていること
        rows: b.strip.children.length
          ? Math.round(b.strip.scrollHeight / b.strip.children[0].offsetHeight)
          : 0,
        overflowing: b.strip.scrollWidth - b.strip.clientWidth > 1,
        moreLeft: b.wrap.classList.contains("moreLeft"),
        moreRight: b.wrap.classList.contains("moreRight"),
        scrollLeft: Math.round(b.strip.scrollLeft),
      })),
      // ステージの帯だけの近道（回帰テストが読む）
      stage: stage && {
        active: [...stage.strip.children].findIndex((el) => el.classList.contains("active")),
        count: stage.count ? (stage.count.hidden ? "" : stage.count.textContent) : "",
      },
    }),
  };
})();
