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
  /* ---- 参考書のページに埋め込まれているか（?embed=1）----
     DESIGN_reference_centric.md §2-4 (2)。子がやることは**3つだけ**で、そのうち
     ① `<html class="embed">` と `<base target="_top">` は各 HTML の head の同期な1行が持つ
        （ここは body の末尾で読むので、描いてから消すとちらつく）。
     ここが持つのは ②（高さを親に知らせる）と ③（「← 参考書へ戻る」の帯を作らない）。
     ⚠ `embed=1` が無ければ**1バイトも挙動を変えない**（元の URL は今までどおり）。 */
  let embedded = false;
  try { embedded = new URLSearchParams(location.search).get("embed") === "1"; } catch (e) { /* 何もしない */ }

  /* ② 高さを親に知らせる（§2-4 (2)②・(6)）。
     親は iframe を中身の高さに合わせる ＝ **iframe の中にスクロールを作らない**
     （スマホ縦の二重スクロールが一番の事故）。
     約束: 子 → 親 `{ type: 'slz-embed', v: 1, h: <整数 px> }` を `location.origin` 宛てに。親 → 子は無し。
     ⚠ **前と同じ h は送らない**（発振の見張りが効くようにする。ion の test.html が
        「1秒以内に止まる・同じ高さが2度来ない」を見ている）。
     ⚠ 測るのは `documentElement` の**外枠の高さ**。`scrollHeight` は「viewport か中身の大きい方」なので、
        親が伸ばすたびに一緒に育って輪が閉じる。 */
  if (embedded && window.parent !== window && typeof ResizeObserver === "function") {
    let sent = -1;
    const tell = () => {
      const h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      if (h === sent || !(h > 0)) return;
      sent = h;
      try { parent.postMessage({ type: "slz-embed", v: 1, h }, location.origin); } catch (e) { /* 送れなくても本体は動かす */ }
    };
    try {
      new ResizeObserver(tell).observe(document.documentElement);
      tell();
    } catch (e) { /* 観測できない環境では高さを送らないだけ（親は既定の高さのまま） */ }
  }

  /* ---- 参考書から来たときの戻り道（2026-09-19・参考書を無機・理論へ広げる 便0b）----
     CLAUDE.md「アプリ横断のリンクは往復にする」。参考書（/reference/）の `:::link app:` は
     `?from=reference&page=<ページid>` を付けて来る。ここは**全ページが読む**ので1か所で効く。
     ⚠ 知ってよいのは相手の URL の形（`/reference/<ページid>/`）だけ。ページの一覧は持たない。
     ⚠ page が読めない形なら索引（`/reference/`）へ戻す（行き止まりにしない・勝手な URL を作らない）。
     ⚠ ヘッダーの中には入れない（320×568 でヘッダー 120px 以下の約束）。ヘッダーの直後に細い帯で置く。
     ⚠ `_top` ＝ どこかに埋め込まれていても、枠ではなくタブごと参考書へ戻す（qa の帯と同じ）。
     ⚠ ③ **`embed=1` のときは帯を作らない**（§2-4 (2)③。`embed=1` が `from=reference` に優先）。
        参考書のページの中に居るのだから「参考書へ戻る」は無意味。
        ⚠ 帯は header の**外**なので、CSS で header を隠しても消えない ＝ ここで止める。 */
  try {
    const p = new URLSearchParams(location.search);
    const head = document.querySelector("header");
    if (!embedded && p.get("from") === "reference" && head && !document.querySelector(".refBack")) {
      const page = p.get("page") || "";
      const band = document.createElement("div");
      band.className = "refBack";
      const a = document.createElement("a");
      a.className = "refBackLink";
      a.href = "../reference/" + (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) ? page + "/" : "");
      a.target = "_top";
      a.textContent = "← 参考書へ戻る";
      band.appendChild(a);
      head.after(band);
    }
  } catch (e) { /* 戻り道が作れなくても本体は動かす */ }

  /* ---- モードの帯を組み立てる（2026-08-10）----
     ここは本来「見た目係」だが、**モードの帯だけは中身も組み立てる**。
     以前は6ページが帯を手書きしていて、どこから何へ行けるかがばらばらになり、
     いちばん新しい2モード（電池・自由に組み合わせる）が事実上たどり着けなかった。
     出どころは model.js の MODES ただ1つで、ここは並べるだけ。
     ページ側は `<nav class="modeBar strip" data-mode="index"></nav>` と空で置く。 */
  const modeBar = document.querySelector("header nav.modeBar");
  if (modeBar && !modeBar.children.length && typeof modeBarFor === "function") {
    for (const m of modeBarFor(modeBar.dataset.mode || "")) {
      const a = document.createElement("a");
      a.className = "modeLink" + (m.group === "hub" ? " hub" : "");
      a.href = m.href;
      a.textContent = m.label;
      a.dataset.mode = m.id;
      modeBar.appendChild(a);
    }
  }

  /* ---- 束の切り替え（2026-09-26・I-0171/I-0172）----
     「半反応式の一覧」と「半反応式を組む」、「ステージで組む」と「自由に組み合わせる」は
     同じ仕事の2つの面なので、帯では1本にまとめ、**ページ上端の切り替え**で行き来する。
     ⚠ ヘッダーには足さない（320×568 で 120px 以下の約束）。<main> の先頭に置く。
     ⚠ 埋め込み（?embed=1・参考書の中）では出さない —— 埋め込みは1つの面だけを見せる場所。
     いまどれを開いているかは URL で決める: 同じファイルの仲間のうち、
     href のクエリ（free=1 など）がすべて今の URL にそろっているもの。いちばん細かく合うものを採る。 */
  try {
    const main = document.querySelector("main");
    const fam = modeBar && typeof familyOf === "function" ? familyOf(modeBar.dataset.mode || "") : [];
    const q = new URLSearchParams(location.search);
    if (main && fam.length > 1 && q.get("embed") !== "1") {
      const file = (location.pathname.split("/").pop() || "index.html");
      let active = null, best = -1;
      for (const m of fam) {
        const [mf, mq] = m.href.split("?");
        if (mf !== file) continue;
        const need = [...new URLSearchParams(mq || "")];
        if (!need.every(([k, v]) => q.get(k) === v)) continue;
        if (need.length > best) { best = need.length; active = m.id; }
      }
      const nav = document.createElement("nav");
      nav.className = "familyTabs";
      nav.setAttribute("aria-label", "この仕事の面を切り替える");
      for (const m of fam) {
        const a = document.createElement("a");
        a.href = m.href;
        a.textContent = m.tab || m.label;
        a.dataset.mode = m.id;
        if (m.id === active) { a.className = "active"; a.setAttribute("aria-current", "page"); }
        nav.appendChild(a);
      }
      main.prepend(nav);
    }
  } catch (e) { /* 切り替えが作れなくても本体は動かす */ }

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
      // どれも開いていないとき（自由組み立てモード）は「0/14」になってしまうので出さない
      b.count.hidden = !over || !items.length || i < 0;
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

  const stage = bars.find((b) => b.strip.id === "stageNav");

  /* ---- ステージ一覧のシート ----
     帯に出ているのは番号だけなので、**押す前にどの反応へ跳ぶのかが分からない**
     （目的の反応に行くには総当たりになる）。番号の title 属性に名前は入っているが、
     ホバーは指では出ないので**タッチ端末では情報がゼロ**だった。

     ヘッダーには段を足せない（320×568 で 116px ＝ 画面の 20.4%。回帰テストと
     tools/check-mobile.mjs が 120px 以下を見張っている）。そこで一覧は
     **閉じているあいだ高さを持たない**全画面のシートにし、開く釦だけを
     既存のステージ帯と同じ行に置く ＝ ヘッダーは1段も太らない。

     ここも見た目係のままにする。中身は DOM の約束だけから読む:
       ・`.strip` の子が押せるボタンで、その textContent が番号
       ・行き先の名前は `data-label`（無ければ `title`）
       ・開いているものに `.active` が付く
     化学の判断もステージの中身も、相変わらず一切持たない。 */
  let sheet = null, sheetList = null, opener = null;

  const labelOf = (el) =>
    (el.dataset && el.dataset.label) || el.getAttribute("title") || el.textContent || "";

  function closeSheet(refocus) {
    if (!sheet || sheet.hidden) return;
    sheet.hidden = true;
    opener.setAttribute("aria-expanded", "false");
    if (refocus) opener.focus();
  }

  function openSheet() {
    sheetList.innerHTML = "";
    [...stage.strip.children].forEach((btn, i) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "sheetRow" + (btn.classList.contains("active") ? " active" : "");
      const no = document.createElement("span");
      no.className = "sheetNo";
      no.textContent = btn.textContent.trim() || String(i + 1);
      const nm = document.createElement("span");
      nm.className = "sheetName";
      nm.textContent = labelOf(btn);
      row.append(no, nm);
      // 一覧は帯の代わりに押すもの。押したら閉じて、帯の当該ボタンをそのまま押す
      // （行き先の決定は各モードの buildStageNav が持つ onclick に任せる）
      row.onclick = () => { closeSheet(false); btn.click(); };
      sheetList.appendChild(row);
    });
    sheet.hidden = false;
    const cur = sheetList.querySelector(".sheetRow.active") || sheetList.firstElementChild;
    if (cur) {
      // scrollIntoView はページ本体まで動かすので、帯と同じく自分で寄せる
      sheetList.scrollTop = cur.offsetTop - (sheetList.clientHeight - cur.offsetHeight) / 2;
      cur.focus({ preventScroll: true });
    }
    opener.setAttribute("aria-expanded", "true");
  }

  if (stage) {
    opener = document.createElement("button");
    opener.type = "button";
    opener.id = "stageListBtn";
    opener.className = "navList";
    opener.title = "ステージ一覧をひらく";
    opener.setAttribute("aria-haspopup", "dialog");
    opener.setAttribute("aria-expanded", "false");
    opener.setAttribute("aria-controls", "stageSheet");
    const icon = document.createElement("span");
    icon.className = "navListIcon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = "☰";
    const word = document.createElement("span");
    word.textContent = "一覧";
    opener.append(icon, word);
    opener.onclick = () => (sheet.hidden ? openSheet() : closeSheet(true));
    // 帯そのもの（.hscroll）ではなく、その親の .stageBar に置く。
    // 帯の中に入れると横スクロールで流れて行ってしまう
    const holder = stage.wrap.parentElement;
    holder.insertBefore(opener, holder.firstChild);

    sheet = document.createElement("div");
    sheet.id = "stageSheet";
    sheet.className = "sheetBack";
    sheet.hidden = true;
    const box = document.createElement("div");
    box.className = "sheet";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "ステージ一覧");
    const head = document.createElement("div");
    head.className = "sheetHead";
    const ttl = document.createElement("span");
    ttl.className = "sheetTitle";
    ttl.textContent = "ステージ一覧 — 行き先をえらぶ";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "sheetClose";
    close.setAttribute("aria-label", "一覧を閉じる");
    close.textContent = "✕";
    close.onclick = () => closeSheet(true);
    head.append(ttl, close);
    sheetList = document.createElement("div");
    sheetList.className = "sheetList";
    box.append(head, sheetList);
    sheet.appendChild(box);
    // 背景（シートの外）を押したら閉じる。指でもマウスでも同じ
    sheet.addEventListener("click", (e) => { if (e.target === sheet) closeSheet(true); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(true); });
    document.body.appendChild(sheet);
  }

  /* テスト・監査用フック */
  window.IonHeader = {
    refresh: () => bars.forEach(showActive),
    openList: () => { if (sheet && sheet.hidden) openSheet(); },
    closeList: () => closeSheet(false),
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
      // ステージ一覧のシート（帯を持たないページでは null）
      sheet: sheet && {
        open: !sheet.hidden,
        rows: sheetList.children.length,
        active: [...sheetList.children].findIndex((r) => r.classList.contains("active")),
        labels: [...sheetList.children].map((r) => r.querySelector(".sheetName").textContent),
      },
    }),
  };
})();
