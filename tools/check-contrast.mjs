#!/usr/bin/env node
/**
 * 文字と地のコントラスト検査（WCAG 2.1 AA）—— アプリの主要な面をなめて、
 * **AA（4.5:1／大きい字は 3:1）を割っている文字の種類を数える。**
 *
 * ■ なぜ要るか
 * 2026-09-10、面B（アプリの中の資料ペイン）の添え物の字5種が AA を割っていることが
 * 実測で分かった（`DESIGN_reference_book.md` §20-9 の2）。⚠ **色を直すだけだと、
 * 次に誰かが `:root` を触ったとき黙って戻る。**「直した」を人の記憶に置かないための道具。
 *
 * ★ 手本は `tools/gen-reference-pages.mjs` の `checkLightCoverage`（明るい地への
 *   読み替え漏れを機械で赤にする）。同じ作り —— **名簿に無いものが出たら赤**。
 *
 * ■ 何を見るか
 * 主要な面（🧪自由・🧩パズル・⚗反応機構・📚学習・📖資料ペイン・分子モーダル・
 * 命名クイズ・呼び出し一覧・🧊立体）を **1280px と 375px** で実際に開く。
 * ★ さらに **`reference.json` のページを1枚ずつ**、
 *   **面B（アプリの中の資料ペイン・暗い地）と 面A（`/reference/` の独立ページ・明るい地）の両方**で見る
 *   ＝ ページを足せば見る面も自動で増える（検査にページ名を書き写さない）。
 * ⚠ **面Aを一緒に見るのが要点** —— 面Aは `LIGHT_CSS` が `:root` を読み替えているので、
 *   **暗い地側の値を動かすと読み替えの前提が動く**（設計書 §20-5 / §21-4）。
 * 各面で**文字を持つ要素を全部なめて**
 *   ① 文字色（`color`。SVG は `fill`）
 *   ② ⚠ **祖先をさかのぼって重ねた実効の地色**（半透明の板が何枚も重なる）
 *   ③ 実際の px と太さ（大きい字の緩和を**見かけでなく実測で**判定する）
 * から WCAG のコントラスト比を出す。
 *
 * ⚠ **地の色は1つではない。** 同じ `.ref-note` でも、素の背景の上・パネルの上・
 *   モーダルの上で比が変わる。★ **種類ごとに「いちばん悪かった地」を正とする。**
 *
 * ■ 数えないもの（★ 除外は「見かけ」ではなく **WCAG の条文** で決める）
 *   ① **効かなくなっている操作部品**（`:disabled` / `aria-disabled="true"`）
 *      …… WCAG 1.4.3 は "inactive user interface components" を対象外にしている。
 *      ⚠ 実際、`.view-btn:disabled{opacity:.42}` の ⏮ が **2.64:1** で出る。
 *      これを直そうとすると「押せない」の手がかりのほうを壊す。
 *   ② **地が画像（`url()`）の上にある字** …… 色に分解できないので**計算できない**。
 *      ⚠ 「見た」ふりをせず、件数を別に出す。
 *      ★ **グラデーションは計算する**（節を全部候補にして、いちばん悪い節を採る）。
 *      ⚠⚠ **層ごとに分けて、いちばん上の覆っている層で決める** ——
 *        `backgroundImage` 全体から節をまとめて拾い、半透明の節を積み上げると、
 *        `#left-panel` の**画面の端にしか無い水色の光**が全部の字の地になり、
 *        **偽の違反が 15 種**出た（実測・設計書 §21-7）。件数は別に出す。
 *
 * ■ ⚠ この道具は**手で走らせるもの ＝ 門番ではない。**
 *   ★ コミットのたびに走る門番は `assembler/tests.js` の **`CT1`**（`--text-muted` の字だけを深く見る）。
 *   ここは**広く見る**係（面Aも・全部の文字も・名簿つき）。役割が違う（設計書 §21-6）。
 *
 * ■ 名簿（CONTRAST_KEEP）
 * ⚠ **既に割れているものが他にもある。** 全部直すのは別の仕事なので、
 * **いま割れているものを名簿に載せて「これ以上増やさない」**形にしてある。
 *   - 名簿の値は `{ min: 実測値, why: '理由' }`。⚠ **1件ずつ理由を書くこと。**
 *   - ★ **名簿に載せても「今より悪くする」ことはできない**（`min` を下回ったら赤）
 *     ＝ 名簿は逃げ道ではなく**床**。
 *   - ★ 名簿にあるのに**もう割れていない**ものも赤にする（＝ 直したら名簿から降ろす）。
 *
 * ■ 使い方
 *   node tools/check-contrast.mjs [--url=http://localhost:8502/assembler/] [--list]
 *   `--list` は名簿の形で全違反を吐く（名簿を作り直すときだけ使う）。
 * 落ちたら終了コード 1。
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Playwright は tools/record/ のものを借りる（check-desktop.mjs と同じ作り）。
 *  ⚠ node_modules は追跡外なので **git worktree には無い** ＝ 本体の作業ツリーも当たる。 */
function loadPlaywright() {
    const roots = [ROOT];
    try {
        const out = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
        out.split('\n').filter(l => l.startsWith('worktree ')).forEach(l => roots.push(l.slice(9).trim()));
    } catch (e) { /* git が無くても本筋は動く */ }
    if (process.env.NODE_PATH) roots.push(path.resolve(process.env.NODE_PATH, '..', '..'));
    for (const r of roots) {
        try { return createRequire(path.join(r, 'tools/record/')).call(null, 'playwright'); } catch (e) { /* 次を試す */ }
    }
    console.error('Playwright が見つかりません。tools/record で `npm install` を1度だけ実行してください。');
    process.exit(1);
}
const { chromium } = loadPlaywright();

const args = process.argv.slice(2);
const arg = (k, d) => { const a = args.find(x => x.startsWith(k + '=')); return a ? a.slice(k.length + 1) : d; };
const URL_ = arg('--url', 'http://localhost:8502/assembler/');
const LIST = args.includes('--list');

/* ==========================================================================
 * ★ 名簿 —— **いま AA を割っているもの**（2026-09-10 実測）。
 *   ⚠ 1件ずつ理由を書く。理由が書けないなら名簿ではなく色のほうを直す。
 *   `min` は実測値。**これを下回ったら赤**（＝ これ以上悪くできない）。
 * ========================================================================== */
const CONTRAST_KEEP = {
    /* --- 臭素の茶 `--color-br: #a85d00`（2種・2026-09-10 実測）------------------
       ⚠ **これは「添え物の字」ではなく「元素の色」**。原子の色分け（C 銀 / O 赤 / N 青 / Cl 緑 /
         S 黄 / Br 茶 / I 青紫）は装飾ではなく**元素の区別そのもの**で、`:root` の注記のとおり
         **I の #7d5fff と色相を正反対に置く**ために選んである（ヨードホルム反応で同じ画面に出る）。
       ★ 明るくして AA に載せること自体はできる（#c06a00 で 4.65:1・色相はそのまま）。
         ⚠ **ただし `tools/gen-isomer-pages.mjs` が同じ値を焼き込んでいる**（/isomers/ の13枚）ので、
           そちらを焼き直さないと**同じ Br が2つの色を持つ**。★ **この2つを1つの決めとして
           ユーザーに出す**（発注は「添え物の字」だけを頼んでいる）＝ ここでは床だけ引いておく。
       ★ 元素記号そのものは字で読める（色だけが手がかりではない）ので、実害はいまのところ無い。 */
    '.atom-btn.atom-br > span': { min: 3.73, why: '臭素の茶 #a85d00（パレットの札）。元素の色は意味を持ち、I と色相を分ける必要がある。直すなら /isomers/ の焼き直しと同時（ユーザー判断待ち）' },
    'svg text.svg-atom-text@var(--color-br)': { min: 4.02, why: '臭素の茶 #a85d00（分子図の原子ラベル）。同上' },
};

/* ==========================================================================
 * 見る面。`enter` はページ内で走らせて面を出す手順（check-desktop.mjs と同じ流儀）。
 * ⚠ **モーダルは閉じない**（モーダルの上に載る字こそ、地が変わって比が動く場所）。
 * ========================================================================== */
const SCREENS = [
    {
        name: '🧪 自由（分子を1つ描いた状態）', enter: async () => {
            window.game.setMode('free');
            window.game.summonMolecule('エタノール');
            window.game.updateDrawing();
        }
    },
    {
        name: '🧩 パズル（お題選択のモーダル）', enter: async () => {
            window.game.setMode('puzzle');
        }
    },
    {
        name: '⚗ 反応機構（再生画面）', enter: async () => {
            window.game.setMode('learn');
            document.getElementById('study-modal').classList.add('hidden');
            if (window.reactionPlayer) window.reactionPlayer.enter(0);
        }
    },
    {
        name: '📚 学習（アコーディオンを全部開く）', enter: async () => {
            window.game.setMode('learn');
            window.game.setStudyOpen(true);
            document.querySelectorAll('#study-modal details').forEach(d => { d.open = true; });
        }
    },
    /* 📖 資料ペイン（面B）は **reference.json のページを1枚ずつ**見る（下で展開する）。
       ⚠ 1枚で済ませると、そのページに出てこない書式（図の説明・囲み）を見落とす
          —— 実際 `.ref-figure-cap` は alkane-naming には1つも無い。
       ★ ページを足せば見る面も自動で増える（検査にページ名を書き写さない）。 */
    {
        name: '🔍 分子モーダル', enter: async () => {
            window.game.setMode('free');
            window.game.summonMolecule('酢酸');
            window.game.updateDrawing();
            window.game.openMoleculeModal();
        }
    },
    {
        name: '✏ 命名クイズ', enter: async () => {
            window.game.setMode('free');
            const b = document.getElementById('btn-naming-quiz')
                || document.querySelector('[data-quiz="naming"]');
            if (b) b.click();
        }
    },
    {
        name: '📇 名称で呼び出す（候補一覧）', enter: async () => {
            window.game.setMode('free');
            const i = document.getElementById('summon-input');
            if (i) { i.value = 'エタ'; i.dispatchEvent(new Event('input', { bubbles: true })); }
        }
    },
    {
        name: '🧊 立体対照ビュー', enter: async () => {
            window.game.setMode('free');
            window.game.summonMolecule('乳酸');
            window.game.updateDrawing();
            const b = document.getElementById('btn-stereo');
            if (b) b.click();
        }
    },
];

/* ========================================================================== */
/* ページの中で走る採取。⚠ ここは Node ではなくブラウザの文脈。                 */
/* ========================================================================== */
function collectInPage() {
    /* --- 色の道具 ------------------------------------------------------- */
    const parse = (s) => {
        if (!s) return null;
        const m = /^rgba?\(([^)]+)\)$/.exec(s.trim());
        if (!m) return null;
        const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
        if (p.length < 3 || p.some(Number.isNaN)) return null;
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    /** 上（fg）を下（bg・不透明）に重ねる */
    const over = (fg, bg) => ({
        r: fg.r * fg.a + bg.r * (1 - fg.a),
        g: fg.g * fg.a + bg.g * (1 - fg.a),
        b: fg.b * fg.a + bg.b * (1 - fg.a),
        a: 1,
    });
    const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => {
        const x = lum(a), y = lum(b);
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const hex = (c) => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');

    /** ⚠ 見えているか。矩形が無い・display:none・visibility:hidden・透明は数えない */
    const visible = (el) => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        const b = el.getBoundingClientRect();
        return b.width >= 1 && b.height >= 1;
    };

    /**
     * ⚠⚠ **実効の地色**。祖先をさかのぼって、不透明な地に当たるまで半透明を重ねる。
     *
     * ★ 返すのは**候補の配列**（ふつうは1色）。⚠ **地は1色とは限らない** ——
     *   `linear-gradient` の上に載る字は、**帯のどこに来るかで比が変わる**。
     *   ★ グラデーションは**色の節を全部**候補にして、あとで**いちばん悪い節**を正とする
     *     （＝ 「端は通っているが真ん中で読めない」を見逃さない）。
     * ⚠ 画像（`url()`）など**色に分解できない**ものだけ `unknown` を返す ＝ 「見た」ふりをしない。
     */
    const partialSeen = [];
    const effectiveBg = (el) => {
        const stack = [];
        /** stack を base の上に重ねて畳む */
        const settle = (base) => {
            let b = base;
            for (let i = stack.length - 1; i >= 0; i--) b = over(stack[i], b);
            return b;
        };
        let n = el;
        while (n && n.nodeType === 1) {
            const cs = getComputedStyle(n);
            const bi = cs.backgroundImage;
            if (bi && bi !== 'none') {
                /* 層ごとに分ける（`,` はグラデーションの括弧の中にも出るので、括弧の深さで切る） */
                const layers = [];
                let depth = 0, cur = '';
                for (const ch of bi) {
                    if (ch === '(') depth++;
                    if (ch === ')') depth--;
                    if (ch === ',' && depth === 0) { layers.push(cur); cur = ''; } else cur += ch;
                }
                if (cur.trim()) layers.push(cur);
                const sizes = (cs.backgroundSize || 'auto').split(',').map(s => s.trim());
                const reps = (cs.backgroundRepeat || 'repeat').split(',').map(s => s.trim());
                /* ⚠ **層が要素全体を覆っているか**を見る。
                   ★ `#left-panel` の「まだ横に道具がある」ヒントは **15px / 30px の縁の光**で、
                     覆っていない。覆っていない層の色を地に採ると、
                     **画面の端にしか無い飾りの色を、パネル全体の地として採る**ことになる。
                   ⚠⚠ **これは「外すと赤くなる」ことを実測できていない蓋**（設計書 §21-7）。
                     ★ 偽の違反 15 種を消していたのは、その手前の
                       **「層ごとに分けて、いちばん上の層で決める」**ほう
                       （`#left-panel` はいちばん上の層の1つ目の節が不透明なので、そこで決まる）。
                     ★ **蓋は残す** —— 外しても判定は変わらないが、**測る地そのものが間違う**。
                     ⚠ 「赤くなることを確かめた守り」ではない、と分かる形で書いておく。 */
                const covers = (i) => {
                    const sz = sizes[i] || sizes[0] || 'auto';
                    const rp = reps[i] || reps[0] || 'repeat';
                    return /^(auto|auto auto|cover|100%|100% 100%)$/.test(sz) || /^repeat$/.test(rp);
                };
                let partial = false;
                for (let i = 0; i < layers.length; i++) {
                    const L = layers[i].trim();
                    /* 覆っていない層は地に数えない。⚠ ただし**色が乗っている**ものは
                       「見ていない場所がある」として件数だけ出す（黙って落とさない）。 */
                    if (!covers(i)) {
                        const s = (L.match(/rgba?\([^)]*\)/g) || []).map(parse).filter(Boolean);
                        if (s.some(c => c.a > 0.05)) partial = true;
                        continue;
                    }
                    if (/url\(|image-set|element\(/.test(L)) return { unknown: n.tagName + ' ' + L.slice(0, 40) };
                    const stops = (L.match(/rgba?\([^)]*\)/g) || []).map(parse).filter(Boolean);
                    if (!stops.length) return { unknown: n.tagName + ' ' + L.slice(0, 40) };
                    /* 節が半透明なら、その要素自身の background-color の上に置いてから畳む */
                    const own = parse(cs.backgroundColor);
                    const under = own && own.a >= 0.999 ? own : null;
                    const cand = stops.map(s => (s.a >= 0.999 ? s : (under ? over(s, under) : null))).filter(Boolean);
                    if (cand.length) return { colors: cand.map(settle), partial };
                }
                if (partial) partialSeen.push(n.tagName + (n.id ? '#' + n.id : '') + ' ' + bi.slice(0, 40));
            }
            const c = parse(cs.backgroundColor);
            if (c && c.a > 0) {
                if (c.a >= 0.999) return { colors: [settle(c)] };
                stack.push(c);
            }
            n = n.parentElement || (n.getRootNode && n.getRootNode().host) || null;
        }
        /* 不透明な地に当たらなかった＝ブラウザの既定の白（canvas）に落ちる */
        return { colors: [settle({ r: 255, g: 255, b: 255, a: 1 })] };
    };

    /** 祖先の opacity を掛け合わせる（0.5 の板の上の字は、その板ごと薄くなる） */
    const chainOpacity = (el) => {
        let o = 1, n = el;
        while (n && n.nodeType === 1) {
            const v = parseFloat(getComputedStyle(n).opacity);
            if (!Number.isNaN(v)) o *= v;
            n = n.parentElement;
        }
        return o;
    };

    /** ⚠ 効かなくなっている操作部品か（自分か祖先が `:disabled` / `aria-disabled`）。
     *  WCAG 1.4.3 の "inactive user interface components" ＝ コントラストの対象外 */
    const inactive = (el) => {
        let n = el;
        while (n && n.nodeType === 1) {
            if (n.disabled === true) return true;
            if (n.getAttribute && n.getAttribute('aria-disabled') === 'true') return true;
            n = n.parentElement;
        }
        return false;
    };

    /** ★ 種類の名前。**要素そのものの class** で括る（同じ class は同じ「種類」） */
    const key = (el) => {
        const tag = el.tagName.toLowerCase();
        const cls = (el.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
            /* ⚠ 状態の class は種類を分けない（.active / .hidden などで名簿が膨らむ） */
            .filter(c => !/^(is-|js-)/.test(c) && !['active', 'selected', 'open', 'on', 'show', 'hidden', 'current'].includes(c));
        const svg = el.ownerSVGElement || tag === 'svg' ? 'svg ' : '';
        /* ⚠ 色が**その要素に直接**書いてあるものは、class では区別できない。
           ★ 分子図の原子ラベルは class が1つ（`.svg-atom-text`）で色だけが元素ごとに違うので、
             色を鍵に足さないと **Br 1件の割れが 全原子の割れに見える**（逆に O を直しても気づけない）。 */
        const own = (el.getAttribute && (el.getAttribute('fill') || '')) || (el.style && (el.style.color || el.style.fill)) || '';
        const tail = own ? '@' + own.replace(/\s+/g, '') : '';
        if (cls.length) return svg + tag + '.' + cls.join('.') + tail;
        /* class が無いものは、いちばん近い class 持ちの祖先で括る。
           ⚠ **祖先の class は全部つなぐ。** 1つ目だけにすると `.atom-btn > span` の1本に
             C・O・N・Cl・S・Br の札が全部まとまり、**Br 1件の割れが名簿に載った時点で
             他の5つの退行も一緒に見逃す**（名簿の床は「いちばん悪い1件」で引かれるため）。 */
        let p = el.parentElement, up = '';
        while (p && p.nodeType === 1) {
            const pc = (p.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)
                .filter(c => !/^(is-|js-)/.test(c) && !['active', 'selected', 'open', 'on', 'show', 'hidden', 'current'].includes(c));
            if (pc.length) { up = '.' + pc.join('.') + ' > '; break; }
            if (p.id) { up = '#' + p.id + ' > '; break; }
            p = p.parentElement;
        }
        return svg + up + tag;
    };

    const rows = [];
    const unknown = [];
    const all = document.querySelectorAll('*');
    for (const el of all) {
        const tag = el.tagName.toLowerCase();
        if (['script', 'style', 'title', 'head', 'meta', 'link', 'noscript', 'defs'].includes(tag)) continue;
        /* 直下に「字」を持つ要素だけ（親と子で二重に数えない） */
        let text = '';
        for (const n of el.childNodes) if (n.nodeType === 3) text += n.nodeValue;
        text = text.replace(/\s+/g, ' ').trim();
        if (!text) continue;
        if (!visible(el)) continue;
        if (inactive(el)) continue;                    /* 除外① */

        const cs = getComputedStyle(el);
        const isSvg = !!el.ownerSVGElement;
        let fg = parse(isSvg ? cs.fill : cs.color);
        if (!fg) continue;
        const op = chainOpacity(el);
        if (op < 0.05) continue;                       /* ほぼ見えない＝数えない */
        fg = { ...fg, a: fg.a * op };
        if (fg.a < 0.05) continue;

        const bg = effectiveBg(el);
        if (bg.unknown) { unknown.push({ k: key(el), why: bg.unknown }); continue; }

        const size = parseFloat(cs.fontSize) || 0;
        const weight = parseInt(cs.fontWeight, 10) || 400;
        /* ★ 大きい字の緩和は**実測の px と太さ**で判定する（WCAG: 18.66px 以上の太字 or 24px 以上） */
        const large = size >= 24 || (size >= 18.66 && weight >= 700);
        const need = large ? 3 : 4.5;

        /* ★ 地の候補のうち**いちばん比が悪くなる**ものを正とする（グラデーションの節） */
        let pick = null;
        bg.colors.forEach(b => {
            const c = over(fg, b);
            const r = ratio(c, b);
            if (!pick || r < pick.r) pick = { r, c, b };
        });
        rows.push({
            k: key(el), r: pick.r, need, large,
            size: Math.round(size * 10) / 10, weight,
            fg: hex(pick.c), bg: hex(pick.b),
            text: text.slice(0, 24),
        });
    }
    return { rows, unknown, partial: [...new Set(partialSeen)] };
}

/* ★ 資料ページを reference.json から数え上げて面に足す（ページ名を検査に書かない） */
{
    const base = URL_.replace(/[^/]*$/, '');
    const res = await fetch(base + 'reference.json');
    const pages = await res.json();
    pages.forEach(p => SCREENS.push({
        name: `📖 資料ペイン（面B）: ${p.id}`, enter: async (id) => {
            window.game.setMode('free');
            document.getElementById('study-modal').classList.add('hidden');
            await window.referenceBook.open(id);
        }, argv: p.id,
    }));
    /* ★★ **面A（独立したページ `/reference/`）も同じ物差しで見る。**
       ⚠ 面Aは**明るい地**で、`LIGHT_CSS` が `--text-muted` などを読み替えている（§20-5）。
         ★ 暗い地側の値を動かすと**読み替えの前提が動く**ので、
           「読み替え漏れ」（checkLightCoverage）とは別に、**実際の比**をここで見る。 */
    pages.forEach(p => SCREENS.push({
        name: `📄 面A（明るい地）: ${p.id}`, url: base + '../reference/' + p.id + '/', enter: async () => { },
    }));
    console.log(`■ 資料ページ ${pages.length} 枚を、面B（ペイン）と面A（独立ページ）の両方で見る`);
}

/* ========================================================================== */
const browser = await chromium.launch();
const worst = new Map();      /* 種類 → いちばん悪かった1件 */
const unknownAll = new Map();
const partialAll = new Set();
let sampled = 0;
const screensSeen = [];

for (const [w, h] of [[1280, 900], [375, 812]]) {
    for (const s of SCREENS) {
        const page = await browser.newPage({ viewport: { width: w, height: h } });
        page.on('pageerror', () => { });
        try {
            await page.goto(s.url || URL_, { waitUntil: 'networkidle', timeout: 60000 });
            if (!s.url) {
                await page.waitForFunction(() => window.game && window.STAGES, null, { timeout: 30000 });
                await page.waitForTimeout(400);
                await page.evaluate(s.enter, s.argv);
            }
            /* ★ 面Aは畳んだ目次も開いて中の字を見る（狭い面では畳まれている） */
            if (s.url) await page.evaluate(() => document.querySelectorAll('details').forEach(d => { d.open = true; }));
            await page.waitForTimeout(700);
            const { rows, unknown, partial } = await page.evaluate(collectInPage);
            partial.forEach(p => partialAll.add(p));
            sampled += rows.length;
            screensSeen.push(`${w}px ${s.name}（${rows.length}件）`);
            rows.forEach(r => {
                const cur = worst.get(r.k);
                if (!cur || r.r < cur.r) worst.set(r.k, { ...r, screen: `${w}px ${s.name}` });
            });
            unknown.forEach(u => unknownAll.set(u.k, u.why));
        } catch (e) {
            console.error(`  ⚠ ${w}px「${s.name}」で失敗: ${e.message}`);
            process.exitCode = 1;
        }
        await page.close();
    }
}
await browser.close();

/* ---- 判定 ---------------------------------------------------------------- */
const bad = [];        /* 名簿に無い違反 */
const worse = [];      /* 名簿にあるが、記録より悪くなった */
const stale = [];      /* 名簿にあるが、もう割れていない */
for (const [k, r] of worst) {
    const keep = CONTRAST_KEEP[k];
    if (r.r + 0.005 < r.need) {
        if (!keep) bad.push({ k, ...r });
        else if (r.r + 0.05 < keep.min) worse.push({ k, ...r, was: keep.min });
    }
}
for (const k of Object.keys(CONTRAST_KEEP)) {
    const r = worst.get(k);
    if (r && r.r + 0.005 >= r.need) stale.push({ k, r: r.r, need: r.need });
    if (!r) stale.push({ k, r: null, need: null });
}

const fmt = (x) => `${x.k}\n      ${x.r.toFixed(2)}:1（要 ${x.need}:1）　字 ${x.size}px/${x.weight}　`
    + `文字 ${x.fg} on 地 ${x.bg}\n      面: ${x.screen}　例:「${x.text}」`;

console.log(`■ 見た面: ${screensSeen.length}（1280px と 375px の2幅）／文字の要素 ${sampled} 件／種類 ${worst.size}`);
if (unknownAll.size) {
    console.log(`■ ⚠ 地が計算できなかった種類 ${unknownAll.size}（画像の上）:`);
    for (const [k, why] of unknownAll) console.log(`    ${k} … ${why}`);
}
if (partialAll.size) {
    console.log(`■ ⚠ 要素の**一部だけ**を覆う飾り（縁の光など）${partialAll.size} 件は地に数えていない:`);
    for (const p of partialAll) console.log(`    ${p}`);
}

if (LIST) {
    console.log('\n--- 名簿の形（--list） ---');
    for (const [k, r] of [...worst].sort((a, b) => a[1].r - b[1].r)) {
        if (r.r + 0.005 < r.need) {
            console.log(`    '${k}': { min: ${r.r.toFixed(2)}, why: '' },   // ${r.size}px/${r.weight} ${r.fg} on ${r.bg} ${r.screen} 「${r.text}」`);
        }
    }
}

let ng = 0;
if (bad.length) {
    ng = 1;
    console.error(`\n✖ AA（4.5:1／大きい字 3:1）を割っていて、名簿に無いもの ${bad.length} 種:`);
    bad.sort((a, b) => a.r - b.r).forEach(x => console.error('  ・' + fmt(x)));
    console.error('  ★ 色を直すか、直せない理由を添えて tools/check-contrast.mjs の CONTRAST_KEEP に足すこと');
}
if (worse.length) {
    ng = 1;
    console.error(`\n✖ 名簿にあるが、記録より**悪くなった**もの ${worse.length} 種:`);
    worse.forEach(x => console.error(`  ・${x.k}: ${x.was}:1 → ${x.r.toFixed(2)}:1（名簿は床であって逃げ道ではない）`));
}
if (stale.length) {
    ng = 1;
    console.error(`\n✖ 名簿にあるのに、もう割れていない／見つからないもの ${stale.length} 種:`);
    stale.forEach(x => console.error(`  ・${x.k}: ${x.r === null ? '画面に出てこなかった' : x.r.toFixed(2) + ':1（要 ' + x.need + '）'}`));
    console.error('  ★ 直したなら CONTRAST_KEEP から降ろすこと（名簿だけ残ると「まだ割れている」と読めてしまう）');
}
if (!ng) console.log(`\n✔ AA を割っているのは名簿の ${Object.keys(CONTRAST_KEEP).length} 種だけ（すべて理由つき・記録より悪くなっていない）`);
process.exit(ng || process.exitCode || 0);
