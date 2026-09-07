"use strict";
/* blocks.js — 価数＝高さのブロック（DESIGN_ion_blocks.md・2026-09-07）。

   陽イオンの列と陰イオンの列を、共通の底辺から積み上げる。
   1ブロックの高さ ＝ その種の価数。**高さがそろえば中性の1化学種**。

   ここは schematic.js と同じ**見た目専用**のモジュールで、化学の判断はいっさい持たない。
   三値の判定（そろわない／そろったが最簡でない／そろった）は model.js の
   `ionBlockCheck` が出し、ここはそれを図と文にするだけ。
   ⚠ 判定に座標は使わない。使うのは個数（cn・an）と価数だけ。

   使う側は `IonBlocks.create({...})` で1つ作る。同じ部品を
   イオン反応モード（app.js）と酸化還元の⑥（redox.js）の**両方**が呼ぶ。 */

const IB_NS = "http://www.w3.org/2000/svg";

function ibMk(tag, attrs, parent) {
  const el = document.createElementNS(IB_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

/* 呼び出し側が look を渡さなかったときの見た目。色は持たず、名札だけ SPECIES から取る */
function ibDefaultLook(sp) {
  const disp = (typeof SPECIES !== "undefined" && SPECIES[sp]) ? SPECIES[sp].disp : sp;
  return { color: "#8a8f98", darkText: false, label: disp };
}

/* 判定の色。★ **最簡でない（reducible）を赤にしない** ——
   そろっているのは事実なので、赤にすると「積み替えろ」と読まれる。直し方は「割る」。 */
const IB_TONE = {
  simplest:  { line: "#2e8b57", text: "そろった", kind: "ok" },
  // ⚠ 札は右の狭い場所に出るので2行に折る（1行で書くとはみ出す）
  reducible: { line: "#d19a2e", text: "そろった\n（割れる）", kind: "info" },
  short:     { line: "#c0392b", text: "", kind: "ng" },
  empty:     { line: "#b7c3cd", text: "", kind: "info" },
  invalid:   { line: "#b7c3cd", text: "", kind: "info" },
};

const ibLive = [];
let ibSeq = 0;

/* opts:
     svg        … 描画先の <svg>（必須）
     paletteEl  … イオン一覧のボタンを置く要素（省略可）
     msgEl      … 判定文を出す要素（省略可）
     cations / anions … 選べる種の一覧。混ざった1本の配列を choices に渡してもよい
     choices    … 陽陰の別を持たない一覧（ionBlockChoices で振り分ける）
     look(sp)   … { color, darkText, label }。省略時は無彩色
     cation / anion / cn / an … 初期状態
     formula    … 組成式の上書き（SALT_FORMULA に無い対で、生成物の種を渡す）
     unitPx     … 1価あたりの高さ（既定 30）
     width      … viewBox の幅（既定 340）
     maxUnits   … 図に描く高さの上限（既定 12）。超えたら「多すぎる」と伝える
     onChange(state) … 個数が変わるたびに呼ばれる */
function ionBlocksCreate(opts) {
  const o = opts || {};
  const svg = o.svg;
  const look = o.look || ibDefaultLook;
  const unitPx = o.unitPx || 30;
  const W = o.width || 340;
  const maxUnits = o.maxUnits || 12;
  const split = o.choices ? ionBlockChoices(o.choices) : null;
  const cations = o.cations || (split ? split.cations : []);
  const anions = o.anions || (split ? split.anions : []);
  const st = {
    cation: o.cation || (cations.length === 1 ? cations[0] : null),
    anion: o.anion || (anions.length === 1 ? anions[0] : null),
    cn: o.cn || 0, an: o.an || 0,
  };
  const inst = { id: "ib" + (++ibSeq) };

  const check = () => ionBlockCheck(st.cation, st.anion, st.cn, st.an, o.formula);

  /* ---- 図 ---- */
  function draw() {
    if (!svg) return null;
    const s = check();
    const need = Math.max(2, s.cTotal, s.aTotal);   // 最低2段ぶんは場所を取る（1段だと図が潰れる）
    const shown = Math.min(need, maxUnits);
    const cut = need > maxUnits;
    const padTop = 24, padBottom = 34;
    const H = padTop + shown * unitPx + padBottom;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.innerHTML = "";
    const baseY = H - padBottom;
    /* 右側に札の場所（gutter）を空ける。⚠ ここを空けないと「あと N」「そろった」が
       ブロックの上に重なって読めない（最初の版がそうなっていた）。 */
    const gutter = 62, gap = 16, colW = (W - 6 - gutter - gap) / 2;
    const cx0 = 6, ax0 = cx0 + colW + gap;
    const lineX0 = 6, lineX1 = ax0 + colW + 6;
    const tagX = lineX1 + 4;
    const yOf = (units) => baseY - units * unitPx;

    // 底辺（ここからそろえて積む、の「ここ」）
    ibMk("line", {
      x1: lineX0, y1: baseY, x2: lineX1, y2: baseY,
      stroke: "#8fa0ad", "stroke-width": 2,
    }, svg);

    const drawColumn = (side, sp, n, x0) => {
      const label = side === "cation" ? "陽イオン" : "陰イオン";
      const t = ibMk("text", {
        x: x0 + colW / 2, y: baseY + 16, "text-anchor": "middle",
        "font-size": 11, fill: "#7b8794",
      }, svg);
      t.textContent = sp ? `${label}　高さ ${side === "cation" ? s.cTotal : s.aTotal}` : label;
      if (!sp || n <= 0) {
        // 空の列は「ここに置く」と分かる点線の枠を1段ぶん置く（何もないと図が読めない）
        ibMk("rect", {
          x: x0, y: yOf(1), width: colW, height: unitPx, rx: 8,
          fill: "none", stroke: "#c8d2da", "stroke-width": 1.5, "stroke-dasharray": "5 4",
        }, svg);
        const e = ibMk("text", {
          x: x0 + colW / 2, y: yOf(1) + unitPx / 2 + 4, "text-anchor": "middle",
          "font-size": 11, fill: "#b7c3cd",
        }, svg);
        e.textContent = sp ? "＋で積む" : "選ぶ";
        return;
      }
      const cl = look(sp);
      const per = ionBlockHeight(sp);
      let units = 0;
      for (let k = 0; k < n; k++) {
        if (units + per > maxUnits) break;   // 図からはみ出すぶんは描かない（cut で伝える）
        const yTop = yOf(units + per), h = per * unitPx;
        const g = ibMk("g", { class: "ibBlock", role: "button", tabindex: "0" }, svg);
        g.setAttribute("data-ib-side", side);
        g.setAttribute("data-ib-index", String(k));
        ibMk("rect", {
          x: x0, y: yTop, width: colW, height: h, rx: 8,
          fill: cl.color, stroke: "rgba(0,0,0,.35)", "stroke-width": 1.2,
        }, g);
        // 1段ごとの仕切り。★ 「3価」と字で書くのではなく、**高さが数えられる**ようにする
        for (let j = 1; j < per; j++) {
          ibMk("line", {
            x1: x0 + 6, y1: yTop + j * unitPx, x2: x0 + colW - 6, y2: yTop + j * unitPx,
            stroke: "rgba(255,255,255,.55)", "stroke-width": 1, "stroke-dasharray": "3 3",
          }, g);
        }
        const el = ibMk("text", {
          x: x0 + colW / 2, y: yTop + h / 2 + 5, "text-anchor": "middle",
          "font-size": cl.label.length > 5 ? 12 : 15, "font-weight": "bold",
          fill: cl.darkText ? "#2a3540" : "#fff",
        }, g);
        el.textContent = cl.label;
        if (per > 1) {
          const v = ibMk("text", {
            x: x0 + 7, y: yTop + 13, "text-anchor": "start", "font-size": 10,
            fill: cl.darkText ? "#5a6672" : "rgba(255,255,255,.85)",
          }, g);
          v.textContent = per + "価";
        }
        g.addEventListener("click", () => inst.remove(side, 1));
        units += per;
      }
    };
    drawColumn("cation", st.cation, st.cn, cx0);
    drawColumn("anion", st.anion, st.an, ax0);

    /* ---- 天井の線。★ ここが図の値打ち ——
       **1本に重なっていれば、判定文を読む前にそろったと分かる。** */
    const tone = IB_TONE[s.kind] || IB_TONE.empty;
    const drawTop = (units, color, dash) => {
      if (units <= 0 || units > maxUnits) return;
      ibMk("line", {
        class: "ibTop",   // ⚠ 回帰テストが「線が1本か2本か」を数える印。消さない
        x1: lineX0, y1: yOf(units), x2: lineX1, y2: yOf(units),
        stroke: color, "stroke-width": 2, "stroke-dasharray": dash,
      }, svg);
    };
    if (s.balanced && s.cTotal > 0) {
      drawTop(s.cTotal, tone.line, "none");
      tone.text.split("\n").forEach((line, i) => {
        const cap = ibMk("text", {
          x: tagX, y: Math.max(12, yOf(Math.min(s.cTotal, maxUnits))) + 4 + i * 13,
          "text-anchor": "start", "font-size": 11, "font-weight": "bold", fill: tone.line,
        }, svg);
        cap.textContent = line;
      });
    } else if (s.kind === "short") {
      // そろっていないとき ＝ 線が2本に割れる。差のぶんを帯で塗って「あと N」と書く
      drawTop(s.cTotal, "#c0392b", "6 4");
      drawTop(s.aTotal, "#c0392b", "6 4");
      const lo = Math.min(s.cTotal, s.aTotal), hi = Math.min(Math.max(s.cTotal, s.aTotal), maxUnits);
      if (hi > lo) {
        ibMk("rect", {
          x: lineX0, y: yOf(hi), width: lineX1 - lineX0, height: (hi - lo) * unitPx,
          fill: "#c0392b", opacity: 0.12,
        }, svg);
        const g = ibMk("text", {
          x: tagX, y: yOf(lo) - (hi - lo) * unitPx / 2 + 4, "text-anchor": "start",
          "font-size": 11, "font-weight": "bold", fill: "#c0392b",
        }, svg);
        g.textContent = `あと ${Math.abs(s.diff)}`;
      }
    }
    if (cut) {
      const el = ibMk("text", {
        x: W / 2, y: 13, "text-anchor": "middle", "font-size": 11, fill: "#a4736b",
      }, svg);
      el.textContent = `高さ ${maxUnits} までしか描けない。もっと少ない数でそろえられるはず。`;
    }
    svg.setAttribute("aria-label", s.message);
    return { height: H, truncated: cut };
  }

  /* ---- イオンの一覧（選んで並べる）---- */
  function drawPalette() {
    const wrap = o.paletteEl;
    if (!wrap) return;
    wrap.innerHTML = "";
    const row = (side, list, cur) => {
      if (!list.length) return;
      const r = document.createElement("div");
      r.className = "ibRow";
      const lb = document.createElement("span");
      lb.className = "ibRowLabel";
      lb.textContent = side === "cation" ? "陽イオン" : "陰イオン";
      r.appendChild(lb);
      for (const sp of list) {
        const b = document.createElement("button");
        b.className = "ibPick" + (sp === cur ? " on" : "");
        b.setAttribute("data-ib-side", side);
        b.setAttribute("data-ib-sp", sp);
        b.textContent = `＋ ${look(sp).label}`;
        b.onclick = () => (sp === cur ? inst.add(side, 1) : inst.pick(side, sp));
        r.appendChild(b);
      }
      const m = document.createElement("button");
      m.className = "ibMinus";
      m.setAttribute("data-ib-side", side);
      m.textContent = "− 1つ戻す";
      m.disabled = (side === "cation" ? st.cn : st.an) <= 0;
      m.onclick = () => inst.remove(side, 1);
      r.appendChild(m);
      wrap.appendChild(r);
    };
    row("cation", cations, st.cation);
    row("anion", anions, st.anion);
  }

  function drawMsg() {
    const el = o.msgEl;
    if (!el) return;
    const s = check();
    const tone = IB_TONE[s.kind] || IB_TONE.empty;
    if (typeof setStatusMsg === "function") setStatusMsg(el, s.message, tone.kind);
    else el.textContent = s.message;
  }

  function changed() {
    inst.render();
    if (typeof o.onChange === "function") o.onChange(inst.state());
  }

  inst.render = () => { drawPalette(); drawMsg(); return draw(); };
  inst.state = () => Object.assign(check(), {
    id: inst.id, cations: cations.slice(), anions: anions.slice(), unitPx,
  });
  inst.pick = (side, sp) => {
    if (ionBlockRole(sp) !== side) return inst.state();   // 列を取り違えたら受け付けない
    if (side === "cation") { st.cation = sp; st.cn = 1; } else { st.anion = sp; st.an = 1; }
    changed();
    return inst.state();
  };
  inst.add = (side, n) => {
    const k = n == null ? 1 : n;
    if (side === "cation") { if (!st.cation) return inst.state(); st.cn = Math.max(0, st.cn + k); }
    else { if (!st.anion) return inst.state(); st.an = Math.max(0, st.an + k); }
    changed();
    return inst.state();
  };
  inst.remove = (side, n) => inst.add(side, -(n == null ? 1 : n));
  /* 外から数を入れ直す（係数のステッパーと双方向にするための口）。
     ⚠ 同じ数になるときは onChange を呼ばない —— 呼ぶと係数→ブロック→係数で往復する */
  inst.set = (v) => {
    const next = {
      cation: v.cation === undefined ? st.cation : v.cation,
      anion: v.anion === undefined ? st.anion : v.anion,
      cn: v.cn === undefined ? st.cn : Math.max(0, v.cn | 0),
      an: v.an === undefined ? st.an : Math.max(0, v.an | 0),
    };
    const same = next.cation === st.cation && next.anion === st.anion &&
      next.cn === st.cn && next.an === st.an;
    Object.assign(st, next);
    if (same) inst.render(); else changed();
    return inst.state();
  };
  inst.reset = () => inst.set({ cn: 0, an: 0 });
  inst.destroy = () => {
    const i = ibLive.indexOf(inst);
    if (i >= 0) ibLive.splice(i, 1);
    if (svg) svg.innerHTML = "";
    if (o.paletteEl) o.paletteEl.innerHTML = "";
  };

  ibLive.push(inst);
  inst.render();
  return inst;
}

/* UI テストから駆動するためのフック（window.RedoxEq と同型）。
   `IonBlocks.last()` が直近に作った部品を返すので、iframe 越しに
   `f.contentWindow.IonBlocks.last().add("cation")` のように操作できる。 */
window.IonBlocks = {
  create: ionBlocksCreate,
  all() { return ibLive.slice(); },
  last() { return ibLive.length ? ibLive[ibLive.length - 1] : null; },
};
