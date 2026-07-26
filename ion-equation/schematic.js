"use strict";
/* schematic.js — ブロック模式図の共通描画。

   中和（H⁺ と OH⁻ が結びついて H₂O）と酸化還元（還元剤が出した e⁻ を酸化剤が受け取る）は、
   「1個あたり何個やりとりするか」がそろって初めて過不足なく反応する、という同じ構造をしている。
   ここはその構造だけを図にする**見た目専用**のモジュールで、
   何が受け渡されるか（H⁺ か e⁻ か）という化学の判断はいっさい持たない。

   図の決まり:
     1ブロック＝反応物1個。ブロックは［本体 ＋ 価数ぶんの受け渡し粒］でできている。
     縦1行＝1組（H₂O 1個ぶん／e⁻ 1個ぶん）。ブロックは自分の粒を囲う高さになるので、
     2価なら2行ぶん・3価なら3行ぶんの高さになり、**価数が高さで見える**。
     相手のいない粒は色枠で残り、そのブロック自体の色も変わる＝**あまりが図で分かる**。 */

const SCHEMATIC_NS = "http://www.w3.org/2000/svg";

function schMk(tag, attrs, parent) {
  const el = document.createElementNS(SCHEMATIC_NS, tag);
  for (const k of Object.keys(attrs)) el.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(el);
  return el;
}

/* 太い矢印を start→end に描く（斜めでも向きが合うよう回転で置く） */
function schArrow(svg, x0, y0, x1, y1) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.max(20, Math.hypot(dx, dy));
  const ang = Math.atan2(dy, dx) * 180 / Math.PI;
  const head = Math.min(15, len * 0.5), w = 6, hw = 12;
  schMk("polygon", {
    points: `0,${-w} ${len - head},${-w} ${len - head},${-hw} ${len},0 ${len - head},${hw} ${len - head},${w} 0,${w}`,
    fill: "#ffe14d", stroke: "#9b8a24", "stroke-width": 1,
    transform: `translate(${x0},${y0}) rotate(${ang})`,
  }, svg);
}

/* 個数の集計だけを行う（描画と同じ式をテストからも呼べるように分けてある）。
   side = { need, units: [{ per, count }] } */
function schematicCounts(left, right) {
  const total = (side) => side.units.reduce((s, u) => s + u.per * u.count, 0);
  const lt = total(left), rt = total(right);
  const pairs = Math.min(Math.floor(lt / left.need), Math.floor(rt / right.need));
  return {
    leftTotal: lt, rightTotal: rt, pairs,
    leftLeft: lt - pairs * left.need,
    rightLeft: rt - pairs * right.need,
    rows: Math.max(1, Math.ceil(lt / left.need), Math.ceil(rt / right.need)),
  };
}

/* spec:
     width      … viewBox 幅
     look(sp)   … 種 → { color, darkText, label }（呼び出し側の見た目表から作って渡す）
     left/right … { partSp, need, hollow, units: [{ core:[sp…], per, count, onClick, tag }] }
                  core は本体（残るイオン・金属など）。per はブロック1個が持つ受け渡し粒の数。
                  count はそのブロックを何個並べるか（＝係数・倍率）。
     center     … { sps:[sp…] } … 1組でできる生成物。null なら中央は描かず、左右を直接つなぐ
     markColor  … あまりの粒につける枠の色
   返り値: schematicCounts と同じ集計＋ { height } */
function drawBlockSchematic(svg, spec) {
  const W = spec.width || 460, BW = spec.blockW || 118;
  const c = schematicCounts(spec.left, spec.right);
  const tight = c.rows > 7;
  const R = tight ? 11 : 14;
  // 1行の中に粒が複数あるとき（2H⁺+CO₃²⁻ など）の間隔。
  // ブロックの高さは粒の半径＋5 なので、間隔はそれより広くしないとブロックが重なる
  const subStep = 2 * (R + 5) + 4;
  const needMax = Math.max(spec.left.need, spec.right.need);
  const rowStep = needMax > 1 ? needMax * subStep : (tight ? 34 : 44);
  const top = 26;
  // 倍率を上げすぎたときに図が数千pxまで伸びないよう、描く段数に上限を置く。
  // ここまで来た時点でその答えは行きすぎなので、全部描くより「多すぎる」と伝えるほうが役に立つ
  const maxRows = spec.maxRows || 12;
  /* どのブロックまで描くかを先に決める（高さを確定させてから描くため） */
  const planColumn = (side) => {
    const out = []; let idx = 0, cut = false;
    for (const u of side.units) {
      for (let n = 0; n < u.count; n++) {
        if (Math.floor(idx / side.need) >= maxRows) { cut = true; return { blocks: out, cut }; }
        out.push({ u, start: idx });
        idx += u.per;
      }
    }
    return { blocks: out, cut };
  };
  const plans = { "-1": planColumn(spec.left), "1": planColumn(spec.right) };
  const lastRow = Math.max(0, ...[-1, 1].flatMap((d) =>
    plans[d].blocks.map((b) => Math.floor((b.start + b.u.per - 1) / (d < 0 ? spec.left.need : spec.right.need)))));
  const cut = plans["-1"].cut || plans["1"].cut;
  const H = top + (lastRow + 1) * rowStep + (cut ? 24 : 10);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";

  const leftX = 3, rightX = W - 3 - BW, midX = W / 2;
  const rowY = (k) => top + k * rowStep + rowStep / 2;
  const subY = (row, sub, need) => rowY(row) + (sub - (need - 1) / 2) * subStep;
  const markColor = spec.markColor || "#c0392b";

  const drawColumn = (side, dir) => {   // dir: -1=左, +1=右
    const x0 = dir < 0 ? leftX : rightX;
    const coreCx = dir < 0 ? x0 + 40 : x0 + BW - 40;
    const partCx = dir < 0 ? x0 + BW - 26 : x0 + 26;
    const edgeX = dir < 0 ? x0 + BW : x0;
    const pl = spec.look(side.partSp);
    const paired = c.pairs * side.need;

    for (const blk of plans[dir].blocks) {
      const u = blk.u;
      let idx = blk.start;
      const ys = [];
      for (let j = 0; j < u.per; j++, idx++) ys.push(subY(Math.floor(idx / side.need), idx % side.need, side.need));
      const bTop = ys[0] - R - 5, bBot = ys[ys.length - 1] + R + 5;
      const whole = idx <= paired;
      const g = schMk("g", { class: "schBlock" }, svg);
      if (u.onClick) {
        g.setAttribute("role", "button");
        g.setAttribute("tabindex", "0");
        g.addEventListener("click", u.onClick);
      }
      schMk("rect", {
        x: x0, y: bTop, width: BW, height: bBot - bTop, rx: 12,
        fill: whole ? "#e8d3ee" : "#f6e2d4",
        stroke: whole ? "#b98fc0" : "#d9944a", "stroke-width": whole ? 1.2 : 2,
      }, g);
      if (u.tag) {
        const t = schMk("text", {
          x: dir < 0 ? x0 + 7 : x0 + BW - 7, y: bTop + 12,
          "text-anchor": dir < 0 ? "start" : "end", "font-size": 10, fill: "#7c5c86",
        }, g);
        t.textContent = u.tag;
      }
      // 本体（残るイオン・金属など）。複数あるときは縦に小さく重ねる。
      // core の要素は { sp, n }。n>1 のときは「8H⁺」のように1つにまとめて描く
      // （MnO₄⁻＋8H⁺ のように本体側の個数が多い半反応があるため）
      const midY = (bTop + bBot) / 2;
      u.core.forEach((ct, ci) => {
        const cl = spec.look(ct.sp), cn = u.core.length;
        const text = (ct.n > 1 ? ct.n : "") + cl.label;
        const cy = midY + (ci - (cn - 1) / 2) * (cn > 1 ? 22 : 0);
        schMk("ellipse", {
          cx: coreCx, cy, rx: 33, ry: cn > 1 ? 11 : 19,
          fill: cl.color, stroke: "rgba(0,0,0,.3)", "stroke-width": 1,
        }, g);
        const el = schMk("text", {
          x: coreCx, y: cy + (cn > 1 ? 4 : 5), "text-anchor": "middle",
          "font-size": text.length > 4 ? 11 : 13, "font-weight": "bold",
          fill: cl.darkText ? "#2a3540" : "#fff",
        }, g);
        el.textContent = text;
      });
      if (!u.core.length) {   // NH₃ のように本体を持たない（分子そのものが受け皿）
        const el = schMk("text", {
          x: coreCx, y: midY + 5, "text-anchor": "middle", "font-size": 12, fill: "#9aa4ae",
        }, g);
        el.textContent = u.label || "";
      }
      // 受け渡し粒。hollow の側は「まだ空いている席」として点線の輪だけを描く
      ys.forEach((y, j) => {
        const k = idx - u.per + j, extra = k >= paired;
        const filled = !side.hollow || !extra;
        schMk("circle", {
          cx: partCx, cy: y, r: R,
          fill: filled ? pl.color : "none",
          stroke: extra ? markColor : "rgba(0,0,0,.3)",
          "stroke-width": extra ? 3 : 1,
          "stroke-dasharray": filled ? "none" : "4 3",
        }, g);
        const el = schMk("text", {
          x: partCx, y: y + 4, "text-anchor": "middle", "font-size": R > 12 ? 12 : 10,
          "font-weight": "bold", fill: filled ? (pl.darkText ? "#2a3540" : "#fff") : "#9aa4ae",
        }, g);
        el.textContent = pl.label;
        if (!extra && dir < 0) {
          // 矢印は左の粒から出す（中央に生成物があればそこへ、無ければ右の席へ）
          const row = Math.floor(k / side.need);
          if (spec.center) schArrow(svg, edgeX, y, midX - 34, rowY(row));
          else schArrow(svg, edgeX, y, rightX - 2, rowY(row));
        } else if (!extra && dir > 0 && spec.center) {
          schArrow(svg, edgeX, y, midX + 34, rowY(Math.floor(k / side.need)));
        }
      });
    }
  };

  drawColumn(spec.left, -1);
  drawColumn(spec.right, +1);

  if (spec.center) {
    for (let k = 0; k < Math.min(c.pairs, lastRow + 1); k++) {
      const y = rowY(k), n = spec.center.sps.length;
      spec.center.sps.forEach((psp, j) => {
        const pl = spec.look(psp);
        const cy = y + (j - (n - 1) / 2) * 26;
        schMk("ellipse", {
          cx: midX, cy, rx: 33, ry: n > 1 ? 12 : 18,
          fill: pl.color, stroke: "rgba(0,0,0,.35)", "stroke-width": 1.5,
        }, svg);
        const el = schMk("text", {
          x: midX, y: cy + 5, "text-anchor": "middle", "font-size": 14, "font-weight": "bold",
          fill: pl.darkText ? "#2a3540" : "#fff",
        }, svg);
        el.textContent = pl.label;
      });
    }
    if (c.pairs === 0) {
      const el = schMk("text", {
        x: midX, y: rowY(0) + 5, "text-anchor": "middle", "font-size": 12, fill: "#b7c3cd",
      }, svg);
      el.textContent = "（まだできない）";
    }
  }
  if (cut) {
    const el = schMk("text", {
      x: midX, y: H - 8, "text-anchor": "middle", "font-size": 11, fill: "#a4736b",
    }, svg);
    el.textContent = `多すぎて図に入りきらない（${maxRows} 組ぶんまで表示）。もっと少ない数でそろえられるはず。`;
  }
  return Object.assign({ height: H, truncated: cut }, c);
}

/* 「つり合ってはいるが最簡整数比でない」ときの助言。
   ns（係数・倍率の配列）がすべて g で割り切れるなら、何で割ってどうなるかまで返す。
   割り切れない（＝最簡）なら null。文面は呼び出し側が組み立てられるよう素材も返す。
   labels を渡すと「1H₂SO₄ : 2NaOH」のように物質名つきの答えを添える。 */
function simplestRatioAdvice(ns, labels) {
  const gcd2 = (a, b) => { while (b) { const t = b; b = a % b; a = t; } return a; };
  const g = ns.reduce((a, b) => gcd2(a, b), 0);
  if (!(g > 1)) return null;
  const to = ns.map((n) => n / g);
  const named = labels ? `（${to.map((n, i) => `${n}${labels[i]}`).join(" ： ")}）` : "";
  return {
    gcd: g, from: ns.slice(), to,
    fromText: ns.join(" : "), toText: to.join(" : "),
    text: `同じ組み合わせを ${g} 回くり返しているだけ。すべて ${g} で割って ` +
      `${ns.join(" : ")} → ${to.join(" : ")}${named} にしよう。`,
  };
}
