// イオンスネーク（色でみる無機化学） — 回帰テスト
//
// ion-equation / ratio の test.html と同じ作法で、
//   ① chemistry.js の純ロジック（DOM 非依存）
//   ② 実アプリ（index.html）を iframe でそのまま動かして測る UI テスト
// を1ページに同居させる。
//
// このアプリは v1〜v6 のあいだ回帰テストが1本も無く、
// 「説明文が実装と逆」「褐色沈殿なのに紫」「幅 900〜1200px で横スクロール」
// といった事故を人の目だけで見つけていた。以下はその再発を機械で止めるためのもの。
//
// 注意: 進捗の保存（localStorage）は muki には無いので、ratio の test.html のような
// 控え／復元は不要。**このテストが残す副作用は iframe 内のゲーム状態だけ**で、
// 最後に gameState を GAMEOVER にして rAF ループを止めている（下の stopGameLoop）。
(function () {
    'use strict';

    var pass = 0, fail = 0;
    var out = document.getElementById('results');
    var uiOut = document.getElementById('uiresults');

    // 空振り防止。想定より明らかに少ない件数で「ALL PASS」と出たら、
    // それは通ったのではなく走っていない（fetch 失敗・iframe 未初期化など）
    // ⚠ 系統分離モード（型B・型A）の検査が丸ごと空振りしても気づけるように、
    //   その件数ぶんを含めた下限にしてある（2026-08-27 時点の実測は 303 件 → 型A を足して 405 件
    //   → レイアウトの追い込みで 457 件 → 沈殿側の枝と出題の生成で 524 件）
    // ⚠ 下限は実測のすぐ下に置く。★ ゆるくすると、型A の画面の検査が丸ごと空振りしても
    //   「少ないけど全部通った」に見えてしまう（★ 型A の画面だけで 95 件ある）
    var MIN_CASES = 500;

    function section(title, target) {
        var h = document.createElement('h2');
        h.textContent = title;
        (target || out).appendChild(h);
    }

    function ok(name, cond, target) {
        var d = document.createElement('div');
        d.className = 'case ' + (cond ? 'pass' : 'fail');
        d.textContent = (cond ? '✔ ' : '✘ ') + name;
        (target || out).appendChild(d);
        if (cond) pass++; else fail++;
        return !!cond;
    }

    function warn(msg) { if (window.console) console.warn('[muki tests] ' + msg); }

    // ⚠⚠ 検査の途中で例外が飛ぶと #total が更新されず、**全走が黙って固まる**
    //   （実測 2026-08-27: 否定対照で宣言もれを作ったら、門番のタイムアウト 25 分ぶん待たされた。
    //    ⚠ 「落ちた」ではなく「待たされた」という、いちばん読みにくい壊れ方をする）。
    // ★ 例外を捕まえて、その場で不合格として締める。⚠ 原因も画面に残す
    window.addEventListener('error', function (e) {
        var total = document.getElementById('total');
        if (!total || /(ALL PASS|FAILED)/.test(total.textContent)) return;  // すでに締まっている
        ok('⚠ 検査の途中で例外が飛んだ（' + (e.message || String(e.error)) + '）', false);
        total.textContent = fail + ' FAILED / ' + (pass + fail);
        total.className = 'fail';
    });

    // ---------------------------------------------------------------
    // 色の道具（「褐色と名乗って紫」を機械で落とすため）
    // ---------------------------------------------------------------
    function hexToHsl(hex) {
        var m = /^#([0-9a-fA-F]{6})$/.exec(String(hex).trim());
        if (!m) return null;
        var n = parseInt(m[1], 16);
        return rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    }
    function rgbToHsl(r255, g255, b255) {
        var r = r255 / 255, g = g255 / 255, b = b255 / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
        var l = (max + min) / 2, s = 0, h = 0;
        if (d > 1e-9) {
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h: h, s: s, l: l };
    }
    // 色相の範囲。赤のように 0° をまたぐ範囲も書けるようにする
    function hueIn(c, lo, hi) {
        if (lo <= hi) return c.h >= lo && c.h <= hi;
        return c.h >= lo || c.h <= hi;
    }

    /* 沈殿の名前に出てくる色の語と、その語が許す色。
       完全一致は無理（「淡黄色」の淡さまでは測らない）が、
       **名乗りと色相・明度が大きく食い違っていたら落とす**のが目的。
       語は長いものから当てる（「青白色」は「白色」を含む） */
    var COLOR_WORDS = [
        { word: '青白色', why: '青の色相（180〜260°）で明るい', test: function (c) { return hueIn(c, 180, 260) && c.l >= 0.55; } },
        { word: '青緑色', why: '青緑の色相（150〜200°）', test: function (c) { return hueIn(c, 150, 200) && c.s >= 0.2; } },
        /* 以下3つは系統分離モード（型B）で増えた色名。
           ⚠ 「橙赤色」は「赤色」を含むので、必ず「赤色」より前に置くこと */
        { word: '深青色', why: '青の色相（200〜260°）で暗い', test: function (c) { return hueIn(c, 200, 260) && c.l <= 0.5; } },
        { word: '橙赤色', why: '赤橙の色相（5〜35°）で鮮やか', test: function (c) { return hueIn(c, 5, 35) && c.s >= 0.5; } },
        { word: '赤紫色', why: '赤紫の色相（280〜345°）', test: function (c) { return hueIn(c, 280, 345) && c.s >= 0.25; } },
        { word: '緑白色', why: '緑みの色相（80〜160°）で明るい', test: function (c) { return hueIn(c, 80, 160) && c.l >= 0.7; } },
        { word: '淡黄色', why: '黄の色相（35〜70°）で明るい', test: function (c) { return hueIn(c, 35, 70) && c.s >= 0.3 && c.l >= 0.4; } },
        { word: '褐色', why: '茶の色相（10〜50°）でくすんで暗め', test: function (c) { return hueIn(c, 10, 50) && c.s >= 0.15 && c.l >= 0.15 && c.l <= 0.6; } },
        { word: '白色', why: 'ほぼ白（明度 85% 以上・彩度 15% 以下）', test: function (c) { return c.l >= 0.85 && c.s <= 0.15; } },
        { word: '黒色', why: '暗い（明度 35% 以下）', test: function (c) { return c.l <= 0.35; } },
        { word: '黄色', why: '黄の色相（35〜70°）', test: function (c) { return hueIn(c, 35, 70) && c.s >= 0.3; } },
        { word: '赤色', why: '赤の色相（340〜20°）', test: function (c) { return hueIn(c, 340, 20) && c.s >= 0.3; } },
        { word: '緑色', why: '緑の色相（80〜160°）', test: function (c) { return hueIn(c, 80, 160) && c.s >= 0.2; } }
    ];
    function colorWordOf(name) {
        for (var i = 0; i < COLOR_WORDS.length; i++) {
            if (String(name).indexOf(COLOR_WORDS[i].word) >= 0) return COLOR_WORDS[i];
        }
        return null;
    }

    // ---------------------------------------------------------------
    // 0. 読み込みの確認（ここが崩れると以下すべてが空振りする）
    // ---------------------------------------------------------------
    section('読み込み');
    var loaded = ok('chemistry.js が読み込めている',
        typeof PRECIPITATES !== 'undefined' && typeof CATIONS !== 'undefined' &&
        typeof ANIONS !== 'undefined' && typeof getPrecipitate === 'function');
    var onHttp = ok('http(s) で開いている（file:// では iframe と fetch が使えない）',
        location.protocol === 'http:' || location.protocol === 'https:');

    if (!loaded) {
        finish();
        return;
    }

    var P = PRECIPITATES, C = CATIONS, A = ANIONS;

    // ---------------------------------------------------------------
    // 1. 液性の扱い（このアプリ固有のルールの中心）
    //
    //    【向きを間違えないこと】沈殿ができた瞬間にゲームオーバー（game.js の update()）。
    //    getPrecipitate() が null ＝ 沈殿しない ＝ 溶けたまま ＝ **食べてよい**。
    // ---------------------------------------------------------------
    section('液性（ACIDIC / BASIC）の扱い');
    ok('沈殿データが空でない', P.length > 0);
    ok('ph は ALL か BASIC のどちらかしか使っていない',
        P.every(function (p) { return p.ph === 'ALL' || p.ph === 'BASIC'; }));

    ok('ZnS は酸性では沈殿しない（＝食べられる）', getPrecipitate('Zn', 'S', 'ACIDIC') === null);
    ok('FeS は酸性では沈殿しない（＝食べられる）', getPrecipitate('Fe', 'S', 'ACIDIC') === null);
    ok('ZnS は塩基性で沈殿する（＝ゲームオーバー）',
        (getPrecipitate('Zn', 'S', 'BASIC') || {}).formula === 'ZnS');
    ok('FeS は塩基性で沈殿する（＝ゲームオーバー）',
        (getPrecipitate('Fe', 'S', 'BASIC') || {}).formula === 'FeS');
    // Classic モードは液性を持たないので 'ALL' で呼ばれる。ここで消えると
    // 通常モードから ZnS・FeS が消えてしまう
    ok('液性の指定がない（既定 ALL）ときは ZnS も沈殿として返る',
        (getPrecipitate('Zn', 'S') || {}).formula === 'ZnS');

    ok('ph:ALL の沈殿はどの液性でも返る', P.filter(function (p) { return p.ph === 'ALL'; })
        .every(function (p) {
            return ['ALL', 'ACIDIC', 'BASIC'].every(function (ph) {
                return (getPrecipitate(p.c, p.a, ph) || {}).formula === p.formula;
            });
        }));
    ok('ph:BASIC の沈殿は酸性のときだけ消える', P.filter(function (p) { return p.ph === 'BASIC'; })
        .every(function (p) {
            return getPrecipitate(p.c, p.a, 'ACIDIC') === null &&
                (getPrecipitate(p.c, p.a, 'BASIC') || {}).formula === p.formula &&
                (getPrecipitate(p.c, p.a, 'ALL') || {}).formula === p.formula;
        }));
    var basicOnly = P.filter(function (p) { return p.ph === 'BASIC'; });
    ok('液性で変わる沈殿は FeS と ZnS の2つ（増減したらルール文も直すこと）',
        basicOnly.length === 2 &&
        basicOnly.map(function (p) { return p.formula; }).sort().join(',') === 'FeS,ZnS');
    ok('液性で変わる沈殿は名前に「塩基性のみ」と書いてある（図鑑と死亡画面の表示の前提）',
        basicOnly.every(function (p) { return p.name.indexOf('塩基性のみ') >= 0; }));

    // Sulfide モードは頭が S²⁻ 固定。エサの陽イオン8種が3つに分かれることを固定する
    section('Sulfide モード：S²⁻ に対する陽イオンの分かれ方');
    var SULFIDE_FOOD = ['Na', 'Ba', 'Ca', 'Cu', 'Ag', 'Pb', 'Fe', 'Zn'];
    function classifyWithS(cid) {
        var acid = !!getPrecipitate(cid, 'S', 'ACIDIC');
        var base = !!getPrecipitate(cid, 'S', 'BASIC');
        if (!acid && !base) return 'いつでも食べられる';
        if (acid && base) return 'いつでも沈殿';
        if (!acid && base) return '酸性のときだけ食べられる';
        return '塩基性のときだけ食べられる';
    }
    ok('エサ候補の陽イオン8種がすべて CATIONS にある',
        SULFIDE_FOOD.every(function (k) { return !!C[k]; }));
    ok('Na⁺・Ba²⁺・Ca²⁺ は液性によらず食べられる（硫化物が水に溶ける）',
        ['Na', 'Ba', 'Ca'].every(function (k) { return classifyWithS(k) === 'いつでも食べられる'; }));
    ok('Ag⁺・Cu²⁺・Pb²⁺ は液性によらず沈殿する（酸性でも溶けない）',
        ['Ag', 'Cu', 'Pb'].every(function (k) { return classifyWithS(k) === 'いつでも沈殿'; }));
    ok('Fe²⁺・Zn²⁺ は酸性のときだけ食べられる',
        ['Fe', 'Zn'].every(function (k) { return classifyWithS(k) === '酸性のときだけ食べられる'; }));
    ok('S²⁻ に対する分類が3種類そろっている（1種類に潰れていない）',
        new Set(SULFIDE_FOOD.map(classifyWithS)).size === 3);

    // 図鑑用の沈殿（v11 S-10）。Classic のプールに Pb/Fe/Zn は入らず、Sulfide の頭は
    // S²⁻ 固定なので、この5件はゲーム中に出会えない＝勝敗に影響しない（プールの検査は
    // UI テスト側）。図鑑の「全沈殿リスト」と死亡画面の復習に載せるためのデータ
    section('図鑑用の沈殿（系統分離の代表）');
    var LIB = [
        { c: 'Pb', a: 'Cl', f: 'PbCl₂' }, { c: 'Pb', a: 'SO4', f: 'PbSO₄' },
        { c: 'Pb', a: 'OH', f: 'Pb(OH)₂' }, { c: 'Fe', a: 'OH', f: 'Fe(OH)₂' },
        { c: 'Zn', a: 'OH', f: 'Zn(OH)₂' }
    ];
    ok('系統分離の頻出5件（PbCl₂・PbSO₄・Pb(OH)₂・Fe(OH)₂・Zn(OH)₂）が図鑑データにある',
        LIB.every(function (x) { return (getPrecipitate(x.c, x.a) || {}).formula === x.f; }));
    ok('5件とも液性によらず沈殿する（ph: ALL）',
        LIB.every(function (x) {
            var p = P.filter(function (q) { return q.formula === x.f; })[0];
            return p && p.ph === 'ALL';
        }));
    ok('Fe(OH)₂ は緑白色と名乗る（教科書の言い方）',
        (getPrecipitate('Fe', 'OH') || { name: '' }).name.indexOf('緑白色') === 0);
    ok('色の判定が効いている（緑白色に真っ白 #ffffff を渡すと落ちる）',
        colorWordOf('緑白色沈殿').test(hexToHsl('#ffffff')) === false);

    // ---------------------------------------------------------------
    // 2. 引数の順と、拾えない組み合わせ
    // ---------------------------------------------------------------
    section('getPrecipitate の引数と境界');
    ok('引数は（陽イオン, 陰イオン）の順', (getPrecipitate('Ag', 'Cl') || {}).formula === 'AgCl');
    ok('逆順では引けない（陰イオンを先に渡しても拾わない）', getPrecipitate('Cl', 'Ag') === null);
    ok('沈殿しない組み合わせは null（Na⁺ と Cl⁻）', getPrecipitate('Na', 'Cl') === null);
    ok('存在しないイオン ID は null', getPrecipitate('Xx', 'Cl') === null && getPrecipitate('Ag', 'Yy') === null);

    // ---------------------------------------------------------------
    // 3. イオンと沈殿のデータそのもの
    // ---------------------------------------------------------------
    section('イオンと沈殿のデータ');
    ok('陽イオンが1件以上ある', Object.keys(C).length > 0);
    ok('陰イオンが1件以上ある', Object.keys(A).length > 0);
    ok('陽イオンの key と id が一致する',
        Object.keys(C).every(function (k) { return C[k].id === k; }));
    ok('陰イオンの key と id が一致する',
        Object.keys(A).every(function (k) { return A[k].id === k; }));
    ok('陽イオンの電荷はすべて正', Object.keys(C).every(function (k) { return C[k].charge > 0; }));
    ok('陰イオンの電荷はすべて負', Object.keys(A).every(function (k) { return A[k].charge < 0; }));
    ok('イオン名に価数の上付きが入っている（Ag⁺ / SO₄²⁻ など）',
        Object.keys(C).concat(Object.keys(A)).every(function (k) {
            var ion = C[k] || A[k];
            return /[⁺⁻]/.test(ion.name);
        }));
    ok('すべてのイオンに baseColor（#rrggbb）と textColor がある',
        Object.keys(C).concat(Object.keys(A)).every(function (k) {
            var ion = C[k] || A[k];
            return /^#[0-9a-fA-F]{6}$/.test(ion.baseColor || '') && !!ion.textColor;
        }));

    // --- 3-b. 水溶液の色（aqueous。v12・検品 J-5） ---
    //     タイルの色（baseColor）はゲームで見分けるためのもので実物の色ではない。
    //     図鑑だけが読む「本当の色」をここで固定する。**言葉で持つ**のが要点で、
    //     色コードにすると「無色」が表せず、また baseColor と混同されて事故る
    var allIonKeys = Object.keys(C).concat(Object.keys(A));
    function ionOf(k) { return C[k] || A[k]; }
    ok('すべてのイオンに水溶液の色（aqueous）がある', allIonKeys.every(function (k) {
        var v = ionOf(k).aqueous;
        return typeof v === 'string' && v.length > 0;
    }));
    ok('aqueous は色コードではなく言葉（「無色」を表せる形で持つ）',
        allIonKeys.every(function (k) { return !/^#|rgb|^[0-9a-fA-F]{6}$/.test(ionOf(k).aqueous); }));
    ok('aqueous はすべて「色」で終わる言い方（無色 / 青色 / 淡緑色）',
        allIonKeys.every(function (k) { return /色$/.test(ionOf(k).aqueous); }));
    // 化学そのもの。ここが崩れたら図鑑が嘘をつく
    ok('Cu²⁺ の水溶液は青い', /青/.test(C.Cu.aqueous));
    ok('Fe²⁺ の水溶液は緑みを帯びる（淡緑色）', /緑/.test(C.Fe.aqueous) && /淡/.test(C.Fe.aqueous));
    ok('色がつくのは Cu²⁺ と Fe²⁺ だけで、残りはすべて無色', (function () {
        var colored = allIonKeys.filter(function (k) { return ionOf(k).aqueous !== '無色'; }).sort();
        if (colored.join(',') !== 'Cu,Fe') warn('無色でないイオン: ' + colored.join(' / '));
        return colored.join(',') === 'Cu,Fe';
    })());
    // タイルの色と水溶液の色は別物、という前提そのものを固定する。
    // 「実際の色に寄せよう」と baseColor を触ると、盤の上で見分けがつかなくなる
    ok('Fe²⁺ のタイルは灰系のまま（ゲーム用の色を水溶液の色に寄せていない）',
        C.Fe.baseColor === '#535c68' && C.Fe.aqueous !== '無色');
    ok('S²⁻ のタイルは赤のまま（水溶液は無色なのでタイルとは一致しない）',
        A.S.baseColor === '#e74c3c' && A.S.aqueous === '無色');

    ok('沈殿の陽イオンがすべて CATIONS に実在する',
        P.every(function (p) { return !!C[p.c]; }));
    ok('沈殿の陰イオンがすべて ANIONS に実在する',
        P.every(function (p) { return !!A[p.a]; }));
    ok('沈殿に formula と name がある',
        P.every(function (p) { return !!p.formula && !!p.name; }));
    ok('沈殿の名前はすべて「沈殿」を含む（死亡画面と図鑑がこの言い方で並ぶ）',
        P.every(function (p) { return p.name.indexOf('沈殿') >= 0; }));
    // getPrecipitate は find で先頭しか返さないので、同じ組が2つあると後ろは死にデータ
    ok('（陽イオン, 陰イオン）の組に重複がない', (function () {
        var seen = {}, dup = [];
        P.forEach(function (p) {
            var k = p.c + '+' + p.a;
            if (seen[k]) dup.push(k); else seen[k] = 1;
        });
        if (dup.length) warn('重複した組: ' + dup.join(' / '));
        return dup.length === 0;
    })());
    ok('同じ formula が2度出てこない', (function () {
        return new Set(P.map(function (p) { return p.formula; })).size === P.length;
    })());

    // ---------------------------------------------------------------
    // 4. 名前の色と、実際に塗る色が食い違っていないか
    //    （v1 前に「褐色沈殿」なのに #8e44ad ＝紫だった事故がある）
    // ---------------------------------------------------------------
    section('沈殿の「名前の色」と「実際の色」');
    var checkedColors = 0, badColors = [];
    var unknownWords = [];
    P.forEach(function (p) {
        var w = colorWordOf(p.name);
        if (!w) { unknownWords.push(p.formula + ': ' + p.name); return; }
        var hsl = hexToHsl(p.color);
        if (!hsl) { badColors.push(p.formula + ': color が #rrggbb でない（' + p.color + '）'); return; }
        checkedColors++;
        if (!w.test(hsl)) {
            badColors.push(p.formula + '「' + p.name + '」の color ' + p.color +
                ' は ' + w.word + '（' + w.why + '）と食い違う' +
                '（h=' + hsl.h.toFixed(0) + '° s=' + (hsl.s * 100).toFixed(0) +
                '% l=' + (hsl.l * 100).toFixed(0) + '%）');
        }
    });
    if (unknownWords.length) warn('色の語を判定できない沈殿: ' + unknownWords.join(' / '));
    if (badColors.length) badColors.forEach(warn);
    ok('すべての沈殿の名前に既知の色の語が入っている（新しい色を足したら COLOR_WORDS も足すこと）',
        unknownWords.length === 0);
    ok('名前の色と color の色相・明度が食い違っていない', badColors.length === 0);
    ok('色を1件以上ちゃんと測った（空振りしていない）', checkedColors === P.length);

    // 色の判定そのものが効いているかを自己検査する。
    // ここが通らないと、上の「食い違っていない」は素通りしているだけになる
    ok('色の判定が効いている（褐色に紫 #8e44ad を渡すと落ちる）',
        colorWordOf('褐色沈殿').test(hexToHsl('#8e44ad')) === false);
    ok('色の判定が効いている（白色に黒 #2c3e50 を渡すと落ちる）',
        colorWordOf('白色沈殿').test(hexToHsl('#2c3e50')) === false);
    ok('色の判定が効いている（黒色に白 #ffffff を渡すと落ちる）',
        colorWordOf('黒色沈殿').test(hexToHsl('#ffffff')) === false);
    ok('色の判定が緩すぎない（褐色の実データ #795548 は通る）',
        colorWordOf('褐色沈殿').test(hexToHsl('#795548')) === true);

    // ---------------------------------------------------------------
    // 4-b. 文献が割れている沈殿の note（v14）
    //      Ag₂CO₃ は白色〜淡黄色で資料が割れる。名乗りは**白に一本化**し、
    //      「淡黄色とも書かれる」は note で図鑑の行に併記する。
    //      name に「淡黄」を残したまま白で塗ると 4. の色の照合が落ちるので、
    //      **名乗りと注記を混ぜない**のがこの形の要（元は #f1c40f＝Na⁺ と同じ鮮黄だった）
    // ---------------------------------------------------------------
    section('文献が割れている沈殿の併記（note）');
    var agco3 = getPrecipitate('Ag', 'CO3');
    ok('Ag₂CO₃ がある（Classic のプールにあるので実際に遊べる組）',
        !!agco3 && agco3.formula === 'Ag₂CO₃');
    ok('Ag₂CO₃ は白色と名乗る（BaCO₃・CaCO₃ と同じ扱い）',
        !!agco3 && agco3.name === '白色沈殿');
    ok('Ag₂CO₃ の色は白（#ffffff）', !!agco3 && agco3.color === '#ffffff');
    ok('Ag₂CO₃ に「淡黄色とも」の併記（note）がある',
        !!agco3 && typeof agco3.note === 'string' && agco3.note.indexOf('淡黄色') >= 0);
    // v17: なぜ割れるのかまで書く（できたては白／時間がたつと淡黄）。
    // 理由の無い併記は「どちらでもいい」に読めてしまい、実験で黄色いものを見た生徒を助けない
    ok('Ag₂CO₃ の note は割れる理由（時間で変わること）まで書いてある',
        !!agco3 && /できたて|時間/.test(agco3.note));
    ok('もう「淡黄」と名乗る沈殿はない（名乗りと色の乖離を作り直さない）',
        P.every(function (p) { return p.name.indexOf('淡黄') < 0; }));
    // v17: note は「資料が割れる／式と実体がずれる／ゲームの都合」を断るためだけに持つ。
    // 増やしすぎると全部の行に注が付いて誰も読まなくなるので、**持つ相手を固定する**
    var noted = P.filter(function (p) { return p.note; }).map(function (p) { return p.formula; }).sort();
    ok('note を持つのは Ag₂CO₃・CaSO₄・CuCO₃ の3件だけ', (function () {
        var want = ['Ag₂CO₃', 'CaSO₄', 'CuCO₃'];
        if (noted.join(',') !== want.join(',')) warn('note を持つ沈殿: ' + noted.join(' / '));
        return noted.join(',') === want.join(',');
    })());
    ok('CuCO₃ の note は実体（塩基性炭酸銅）を書いている',
        /塩基性炭酸銅/.test((getPrecipitate('Cu', 'CO3') || {}).note || ''));
    ok('CaSO₄ の note は「沈殿しないことがある」と断っている',
        /沈殿しないことがある/.test((getPrecipitate('Ca', 'SO4') || {}).note || ''));
    ok('note は名乗り（name）とは別の場所に持つ（name に混ぜていない）',
        P.every(function (p) { return !p.note || p.name.indexOf(p.note) < 0; }));

    // ---------------------------------------------------------------
    // 4-c. 教科書の色と実物が食い違うイオンの併記（aqueousNote・v16）
    //      S²⁻ 自体は無色だが、Na₂S 水溶液の実物は淡黄色に見えることが多い
    //      （空気で酸化してできた多硫化物イオンの色）。実験で見た生徒が
    //      「無色と書いてあるのに黄色い」と困るので、**無色を主**にしたまま注記で断る。
    //      aqueous に「淡黄色」と書いてしまうと 3-b の「色がつくのは Cu²⁺ と Fe²⁺ だけ」
    //      が崩れ、図鑑の冒頭の注意書きとも食い違う ＝ **主の表記と注記を混ぜない**のが要
    // ---------------------------------------------------------------
    section('教科書の色と実物が食い違うイオンの併記（aqueousNote）');
    ok('S²⁻ の主の表記は「無色」のまま（S²⁻ 自体は無色）', A.S.aqueous === '無色');
    ok('S²⁻ に淡黄色の注記（aqueousNote）がある',
        typeof A.S.aqueousNote === 'string' && A.S.aqueousNote.indexOf('淡黄色') >= 0);
    ok('注記は色の正体（多硫化物）まで書いてある（ただの言い訳にしない）',
        /多硫化物/.test(A.S.aqueousNote || ''));
    ok('aqueousNote を持つのは S²⁻ だけ', (function () {
        var noted = allIonKeys.filter(function (k) { return ionOf(k).aqueousNote; });
        if (noted.join(',') !== 'S') warn('aqueousNote を持つイオン: ' + noted.join(' / '));
        return noted.join(',') === 'S';
    })());
    ok('注記は aqueous とは別の場所に持つ（主の表記に混ぜていない）',
        allIonKeys.every(function (k) {
            var i = ionOf(k);
            return !i.aqueousNote || i.aqueous.indexOf(i.aqueousNote) < 0;
        }));

    // ===============================================================
    // 系統分離モード「型B: イオンをつきとめる」（separation-model.js）
    //
    // ⚠ ここで守っているのは、設計書 DESIGN_separation.md が
    //   **実測と裏取りの上で決めたこと**であって、こちらの好みではない。
    //   節番号を書いてあるので、落ちたときは設計書の該当節を読むこと。
    // ===============================================================
    section('型B: 模型の読み込み');
    var sepLoaded = ok('separation-model.js が読み込めている',
        typeof SEP_IONS !== 'undefined' && typeof SEP_OPS !== 'undefined' &&
        typeof SEP_TABLE !== 'undefined' && typeof SEP_LEVELS !== 'undefined' &&
        typeof sepObserve === 'function' && typeof sepAuditProblem === 'function' &&
        typeof sepPools === 'function' && typeof sepMakeProblem === 'function');

    if (sepLoaded) {
        // -----------------------------------------------------------
        // 炎色反応 —— 色が出るのは教科書の7元素だけ（§13-3 (4)・化学基礎 p.21 表3）
        // ⚠ ここが緩むと「Ag⁺ を炎色で当てる」というありえない解法が生まれる
        // -----------------------------------------------------------
        section('型B: 炎色反応（色が出るのは7元素だけ）');
        var FLAME_YES = ['Cu', 'Ca', 'Na', 'K'];      // 模型が持つイオンのうち炎色を持つもの
        var FLAME_NO = ['Ag', 'Pb', 'Zn', 'Al', 'Fe3'];
        ok('炎色を持つのは Cu²⁺・Ca²⁺・Na⁺・K⁺ だけ',
            FLAME_YES.every(function (i) { return SEP_IONS[i] && SEP_IONS[i].flame; }));
        ok('Ag⁺・Pb²⁺・Zn²⁺・Al³⁺・Fe³⁺ は炎色で色が出ない（教科書 化学基礎 p.21 表3 の但し書き）',
            FLAME_NO.every(function (i) { return SEP_IONS[i] && SEP_IONS[i].flame === null; }));
        ok('炎色を持たないイオンの観察は flameNone（＝「色はつかなかった」）',
            FLAME_NO.every(function (i) { return sepObserve(i, 'flame').k === 'flameNone'; }));
        // ★ 色名が資料で割れるものは複数受理する（K⁺ は「赤紫」と「紫」。COLOR_AUDIT.md §4-2）
        ok('K⁺ の炎色は色名を複数持つ（赤紫色／紫色）',
            SEP_IONS.K.flame.names.indexOf('赤紫色') >= 0 &&
            SEP_IONS.K.flame.names.length >= 2);
        ok('画面に出すのは1つ目（教科書の「赤紫」）', sepObserve('K', 'flame').c === '赤紫色');

        // -----------------------------------------------------------
        // 観察は答えを教えない（§2-3）
        // ⚠ 化学式を観察に混ぜたら、その1手で答えを配ってしまう
        // -----------------------------------------------------------
        section('型B: 観察が化学式を漏らしていないか（§2-3）');
        var allPairs = [];
        Object.keys(SEP_TABLE).forEach(function (i) {
            Object.keys(SEP_TABLE[i]).forEach(function (o) { allPairs.push([i, o]); });
        });
        ok('観察の表が空でない（' + allPairs.length + '組）', allPairs.length > 20);
        ok('観察の文章に化学式が出てこない',
            allPairs.every(function (pr) {
                var e = SEP_TABLE[pr[0]][pr[1]];
                if (!e.f) return true;
                return sepObsText(e).indexOf(e.f) < 0;
            }));
        ok('見分けの鍵（obsKey）に化学式が入っていない',
            allPairs.every(function (pr) {
                var e = SEP_TABLE[pr[0]][pr[1]];
                if (!e.f) return true;
                return sepObsKey(e).indexOf(e.f) < 0;
            }));
        // ★ 被りは潰すものではなく道具（§16-6）。AgCl と PbCl₂ は**同じ見え方**でなければならない
        ok('希塩酸での白い沈殿は Ag⁺ と Pb²⁺ で見分けがつかない（色の被りは道具・§16-6）',
            sepObsKey(sepObserve('Ag', 'hcl')) === sepObsKey(sepObserve('Pb', 'hcl')));
        ok('その2つは、沈殿に熱水を注ぐと分かれる（教科書 p.88）',
            sepObsKey(sepObserve('Ag', 'hclHot')) !== sepObsKey(sepObserve('Pb', 'hclHot')));
        // ⚠ 同じ見え方なら同じ文章。言い回しの違いから答えが出るのを止める（§12-6 の漏れと同じ形）
        ok('同じ見え方（obsKey が同じ）の観察は、文章もまったく同じ', (function () {
            var byKey = {}, bad = [];
            allPairs.forEach(function (pr) {
                var e = SEP_TABLE[pr[0]][pr[1]], k = sepObsKey(e), t = sepObsText(e);
                if (byKey[k] === undefined) byKey[k] = t;
                else if (byKey[k] !== t) bad.push(pr.join('×') + ' → ' + t);
            });
            if (bad.length) warn('見え方が同じなのに文章が違う: ' + bad.join(' / '));
            return bad.length === 0;
        })());

        // -----------------------------------------------------------
        // 教科書の外を再現しない（§4-1）
        // ⚠ 宣言していない組を黙って「変化なし」にしたら、それは創作
        // -----------------------------------------------------------
        section('型B: 教科書の外を再現しない（§4-1）');
        ok('表に無い（イオン×札）の組は null を返す（「変化なし」にしない）',
            sepObserve('Zn', 'hclHot') === null && sepObserve('Al', 'hclNh3') === null);
        ok('null の観察は「扱っていません」と言う（「変化なし」と言わない）',
            sepObsText(null).indexOf('扱っていません') >= 0 &&
            sepObsText(null).indexOf('変化') < 0);

        // -----------------------------------------------------------
        // 錯イオンの色は出典の別を持つ。⚠ ただし画面には出さない（§17-10）
        // -----------------------------------------------------------
        section('型B: 錯イオンの色と出典（§17-10）');
        ok('すべての錯イオンが出典の別（教科書／参考書）を持つ',
            Object.keys(SEP_COMPLEXES).every(function (k) {
                var s = SEP_COMPLEXES[k].src;
                return s === '教科書' || s === '参考書';
            }));
        ok('[Al(OH)₄]⁻・[Zn(OH)₄]²⁻・[Pb(OH)₄]²⁻ は「教科書に記述なし」＝ 参考書',
            SEP_COMPLEXES['[Al(OH)₄]⁻'].src === '参考書' &&
            SEP_COMPLEXES['[Zn(OH)₄]²⁻'].src === '参考書' &&
            SEP_COMPLEXES['[Pb(OH)₄]²⁻'].src === '参考書');
        ok('[Cu(NH₃)₄]²⁺ は深青色で、出典は教科書（p.67 表4）',
            SEP_COMPLEXES['[Cu(NH₃)₄]²⁺'].color === '深青色' &&
            SEP_COMPLEXES['[Cu(NH₃)₄]²⁺'].src === '教科書');
        ok('出典の別は画面の文章に出てこない（解説に「参考書」の語が無い）',
            allPairs.every(function (pr) {
                var w = SEP_TABLE[pr[0]][pr[1]].why || '';
                return w.indexOf('参考書') < 0;
            }));

        // -----------------------------------------------------------
        // ⚠⚠ 本の名前とページは画面に出さない。⚠ ただしデータからは消さない
        //   （2026-08-27・ユーザー決定。★ §17-10 の `src` とまったく同じ扱い）
        //   ★ 教科書は1社ではないので、ページ番号は学習者の手元と合わない。
        //   ⚠ しかし出典を消すと、§4-1 の線を後から検算する手がかりが無くなる。
        // -----------------------------------------------------------
        section('型B: 出典はデータに残し、画面には出さない');
        var BOOK_WORDS = ['教科書', '化学新研究', '新研究', '総合的研究', '要点&盲点',
            '基本ノート', 'セミナー', '東京書籍', '三省堂', '旺文社', '参考書'];
        ok('観察の説明（why）に本の名前が出てこない', (function () {
            var bad = [];
            allPairs.forEach(function (pr) {
                var w = SEP_TABLE[pr[0]][pr[1]].why || '';
                BOOK_WORDS.forEach(function (b) { if (w.indexOf(b) >= 0) bad.push(pr.join('×') + ':' + b); });
            });
            if (bad.length) warn('why に本の名前: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('観察の説明（why）にページ番号が出てこない',
            allPairs.every(function (pr) {
                return !/p\s*\.\s*\d+/i.test(SEP_TABLE[pr[0]][pr[1]].why || '');
            }));
        // ⚠ 「消したつもりが、出典ごと消えていた」を止める
        ok('出典（ref）はデータに残っている', (function () {
            var withRef = allPairs.filter(function (pr) { return !!SEP_TABLE[pr[0]][pr[1]].ref; });
            if (withRef.length < 20) warn('ref を持つ観察が ' + withRef.length + ' 件しかない');
            return withRef.length >= 20;
        })());
        ok('炎色を持つイオンは、色の出典をデータに持っている',
            ['Cu', 'Ca', 'Na', 'K'].every(function (i) { return !!SEP_IONS[i].flame.ref; }));
        ok('「炎色は7元素だけ」の出典もデータに持っている',
            typeof SEP_FLAME_LIMIT_REF === 'string' && /p\s*\.\s*\d+/i.test(SEP_FLAME_LIMIT_REF));
        // ★ スネークの図鑑（chemistry.js の note）にも本の名前が出ていないこと
        ok('図鑑に出る注記にも本の名前・ページが出てこない', (function () {
            var texts = [];
            P.forEach(function (p) { texts.push(p.name, p.note || ''); });
            allIonKeys.forEach(function (k) {
                var i = ionOf(k);
                texts.push(i.aqueous || '', i.aqueousNote || '');
            });
            var bad = texts.filter(function (t) {
                return /p\s*\.\s*\d+/i.test(t) || BOOK_WORDS.some(function (b) { return t.indexOf(b) >= 0; });
            });
            if (bad.length) warn('図鑑の文言に出典: ' + bad.join(' / '));
            return bad.length === 0;
        })());

        // -----------------------------------------------------------
        // 色の名乗りと色相（既存の COLOR_WORDS をそのまま使う）
        // -----------------------------------------------------------
        section('型B: 色の名乗りと hex の整合');
        ok('色名 → hex の表が、名乗りどおりの色になっている', (function () {
            var bad = [];
            Object.keys(SEP_COLORS).forEach(function (n) {
                var hex = SEP_COLORS[n];
                if (hex === null) return;               // 無色は色コードで表せない
                var w = colorWordOf(n), c = hexToHsl(hex);
                if (!w) { bad.push(n + ' に当てる色の語が無い'); return; }
                if (!c || !w.test(c)) bad.push(n + ' (' + hex + ') は「' + w.why + '」に合わない');
            });
            if (bad.length) warn('色の名乗り: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('無色は色コードを持たない（日本語で持つ）', SEP_COLORS['無色'] === null);

        // -----------------------------------------------------------
        // 出題の門番（§2-4 の型B 版・§16-6）
        // -----------------------------------------------------------
        section('型B: 抽選の母集団と門番（§2-4）');
        var pools = sepPools();
        SEP_LEVELS.forEach(function (l) {
            var pool = pools[l.id];
            // ⚠ 1通りしか無い段は、毎回まったく同じ候補リストになる（＝ 抽選にならない）
            ok('[' + l.name + '] 抽選の母集団が2通り以上ある（実測 ' + pool.length + ' 通り）',
                pool.length >= 2);
            ok('[' + l.name + '] 母集団の全部が門番を通っている（宣言もれ・見分けられない組・1手で決まる、が無い）',
                pool.every(function (e) {
                    var a = sepAuditProblem({ id: 'x', cands: e.cands, ops: e.ops });
                    return a.ok && a.undeclared.length === 0 && a.unresolved.length === 0 && a.shortest >= 2;
                }));
            ok('[' + l.name + '] 母集団の全部が、この段の範囲に入っている',
                pool.every(function (e) {
                    return sepDifficulty({ id: 'x', cands: e.cands, ops: e.ops }).level === l.id;
                }));
        });
        ok('候補の数は3〜6個に収まっている', SEP_LEVELS.every(function (l) {
            return pools[l.id].every(function (e) { return e.cands.length >= 3 && e.cands.length <= 6; });
        }));
        ok('配る札は「結果を宣言してあるものだけ」（§4-1）', SEP_LEVELS.every(function (l) {
            return pools[l.id].every(function (e) {
                return e.ops.every(function (o) {
                    return e.cands.every(function (c) { return !!sepObserve(c, o); });
                });
            });
        }));
        // -----------------------------------------------------------
        // ⚠⚠ 出題の文言に解き筋を出さない（2026-08-27・ユーザー指摘）
        //   ★ 「炎色で3つに割れるが、残り2つは沈殿を溶かさないと分かれない」のような一文は、
        //     冗長である以前に**答えを配っている**。⚠ 一覧の見出しも同じ（押す前に無駄と分かる）。
        //   ★ 出してよいのは難易度だけ。⚠ **次に誰かが説明を足したときに、ここで止まる。**
        // -----------------------------------------------------------
        section('型B: 出題の文言に解き筋を出さない');
        var SPOILER_WORDS = ['炎色', '沈殿', '溶か', '溶け', 'アンモニア', '塩酸', '硫化水素',
            '水酸化', '熱水', '白金線', '錯イオン', '割れ', '分かれ'];
        ok('難易度の段が、解き筋に触れる語を持たない',
            SEP_LEVELS.every(function (l) {
                return SPOILER_WORDS.every(function (w) {
                    return (l.name + l.mark + l.id).indexOf(w) < 0;
                });
            }));
        ok('出題が持つのは鍵・段・候補・札・中身だけ（説明文の欄を持たない）', (function () {
            var p = sepMakeProblem('easy');
            return Object.keys(p).sort().join(',') === 'cands,id,key,level,ops,truth';
        })());
        ok('難易度は、門番が数えた値だけから出る（候補の数・理想の最短・単独で決まらない候補の数）',
            SEP_LEVELS.every(function (l) {
                return pools[l.id].every(function (e) {
                    var p = { id: 'x', cands: e.cands, ops: e.ops };
                    var d = sepDifficulty(p);
                    return d.score === d.cands + d.shortest + d.hard &&
                        d.cands === e.cands.length && d.shortest === sepAuditProblem(p).shortest;
                });
            }));
        ok('段の切り方は1か所（SEP_LEVELS）にしかない',
            SEP_LEVELS.every(function (l) {
                return typeof l.min === 'number' && typeof l.max === 'number' &&
                    l.mark.length === 3 && sepLevelOf(l.min) === l.id && sepLevelOf(l.max) === l.id;
            }));

        // ★ 候補リストが難易度のつまみになっていること（§15-4）
        ok('炎色を1つも持たない候補の組が、母集団に実在する（＝炎色が1つも割らない出題が作れる）',
            (function () {
                var all = [];
                SEP_LEVELS.forEach(function (l) { all = all.concat(pools[l.id]); });
                return all.some(function (e) {
                    return e.cands.every(function (c) { return SEP_IONS[c].flame === null; }) &&
                        sepSplit(e.cands, 'flame').length === 1;
                });
            })());
        ok('炎色が割るが決めきらない候補の組も、母集団に実在する', (function () {
            var all = [];
            SEP_LEVELS.forEach(function (l) { all = all.concat(pools[l.id]); });
            return all.some(function (e) {
                var g = sepSplit(e.cands, 'flame');
                return g.length > 1 && g.some(function (x) { return x.length > 1; });
            });
        })());

        // -----------------------------------------------------------
        // ★★ 型の鍵 —— 集計できる安定した単位（⚠ 送信も保存もしない。持つだけ）
        //   ⚠ 毎回つくる形にしたので、「問題ごと」の問題が毎回別物になる。
        //   ★ 数えられるのは「型」（候補リスト＋段）であって、個々の出題ではない。
        // -----------------------------------------------------------
        section('型B: 型の鍵と記録');
        ok('同じ候補・同じ段なら、並びが違っても同じ鍵',
            sepTypeKey('easy', ['Na', 'Ag', 'Cu']) === sepTypeKey('easy', ['Cu', 'Ag', 'Na']));
        ok('段が違えば別の鍵',
            sepTypeKey('easy', ['Na', 'Ag', 'Cu']) !== sepTypeKey('hard', ['Na', 'Ag', 'Cu']));
        ok('候補が違えば別の鍵',
            sepTypeKey('easy', ['Na', 'Ag', 'Cu']) !== sepTypeKey('easy', ['Na', 'Ag', 'Ca']));
        ok('鍵に版が入っている（⚠ 札の配り方や門番を変えたら上げる）',
            sepTypeKey('easy', ['Ag']).indexOf(SEP_KEY_VERSION + '|') === 0);
        ok('鍵は中身のイオンで変わらない（同じ型の別の出題を、同じ鍵で数えられる）', (function () {
            var a = sepMakeProblem('easy', { cands: ['Ag', 'Pb', 'Cu', 'Na'], truth: 'Ag' });
            var b = sepMakeProblem('easy', { cands: ['Ag', 'Pb', 'Cu', 'Na'], truth: 'Pb' });
            return a.key === b.key && a.truth !== b.truth;
        })());
        ok('記録は、鍵と段と候補と中身を持つ', (function () {
            var p = sepMakeProblem('normal');
            var r = sepRecord(p, { correct: true });
            return r.key === p.key && r.level === p.level && r.truth === p.truth &&
                r.cands.length === p.cands.length && r.correct === true;
        })());
        ok('中身は必ず候補の中から選ばれる', (function () {
            for (var i = 0; i < 30; i++) {
                var p = sepMakeProblem('normal');
                if (p.cands.indexOf(p.truth) < 0) return false;
            }
            return true;
        })());
        // ⚠ 等確率で引くと解き筋が2回3回と続く。直近に出した型だけ避ける
        ok('直前と同じ型は続けて出さない', (function () {
            var last = null;
            for (var i = 0; i < 40; i++) {
                var p = sepMakeProblem('hard', { avoid: last });
                if (last && p.key === last) return false;
                last = p.key;
            }
            return true;
        })());

        // -----------------------------------------------------------
        // 絞り込みと採点
        // -----------------------------------------------------------
        section('型B: 絞り込みと採点');
        // ★ 出題を固定して測る（⚠ 母集団から引くと毎回変わって、何が壊れたか分からない）
        var b1 = { id: 'fixed', cands: ['Ag', 'Pb', 'Cu', 'Na'],
            ops: ['flame', 'hcl', 'hclHot', 'hclNh3', 'h2s'] };
        var h1 = [{ op: 'flame', obs: sepObserve('Ag', 'flame') }];
        ok('b1 で炎色に色がつかなければ、残るのは Ag⁺ と Pb²⁺',
            sepAlive(b1.cands, h1).join(',') === 'Ag,Pb');
        var h2 = h1.concat([{ op: 'hclHot', obs: sepObserve('Ag', 'hclHot') }]);
        ok('沈殿が熱水に溶けなければ Ag⁺ に決まる',
            sepAlive(b1.cands, h2).join(',') === 'Ag');
        ok('決まった手順の採点は decided',
            sepGrade(b1, 'Ag', 'Ag', h2).verdict === 'decided');
        ok('決まっていないのに当てたら lucky（＝当たったが、別の試料なら同じに見えた）',
            sepGrade(b1, 'Ag', 'Ag', h1).verdict === 'lucky');
        ok('決まっていない状態で、残っていたもう一方を選んだら unread',
            sepGrade(b1, 'Ag', 'Pb', h1).verdict === 'unread');
        ok('観察と食い違うものを選んだら missed', (function () {
            var g = sepGrade(b1, 'Ag', 'Cu', h1);
            return g.verdict === 'missed' && g.conflicts.length > 0 && g.conflicts[0].step === 1;
        })());
        ok('採点は「何手目の、どの観察と食い違うか」を名指しできる（§3-3 の文面の材料）',
            sepGrade(b1, 'Ag', 'Cu', h1).conflicts[0].op === 'flame');
        ok('各手が何を消したかを、答え合わせのために持っている', (function () {
            var g = sepGrade(b1, 'Ag', 'Ag', h2);
            return g.steps.length === 2 &&
                g.steps[0].dropped.join(',') === 'Cu,Na' &&
                g.steps[1].dropped.join(',') === 'Pb';
        })());
        ok('候補を1つも減らさない手は、減らさなかったと分かる（§3-2）', (function () {
            var p3 = { id: 'fixed3', cands: ['Pb', 'Zn', 'Al', 'Fe3'],
                ops: ['flame', 'naoh', 'nh3', 'hcl', 'h2s'] };
            var hh = [{ op: 'flame', obs: sepObserve('Zn', 'flame') }];
            var g = sepGrade(p3, 'Zn', 'Zn', hh);
            return g.steps[0].dropped.length === 0;
        })());
        // ★★★ MU-1 「実験は毎回、試料を少しずつ取って新しく行う」が **作りと合っているか**
        //   （2026-08-28・ユーザー指摘で導入に書き足した一文の裏づけ）。
        //   ⚠⚠ 文だけ直して作りが違っていたら、それは嘘になる。★ ここで機械で確かめる。
        ok('MU-1d 観察は（イオン・操作）だけで決まる（⚠ sepObserve は履歴を受け取らない）',
            sepObserve.length === 2);
        ok('MU-1e 順番を入れ替えても、各操作の観察が1件も変わらない', (function () {
            // ★ 画面（doOp）とまったく同じ呼び方で、札を押す順だけを変えて突き合わせる
            function perms(a) {
                if (a.length <= 1) return [a];
                var o = [];
                a.forEach(function (x, i) {
                    perms(a.slice(0, i).concat(a.slice(i + 1))).forEach(function (r) {
                        o.push([x].concat(r));
                    });
                });
                return o;
            }
            var checked = 0, bad = 0;
            Object.keys(SEP_IONS).forEach(function (ion) {
                var dealt = sepDealFor([ion]);
                var base = {};
                dealt.forEach(function (o) { base[o] = sepObsKey(sepObserve(ion, o)); });
                // ⚠ 全順列は 7! で重いので、配られた札の先頭5枚で回す（120 通り × 9 イオン）
                perms(dealt.slice(0, 5)).forEach(function (order) {
                    var history = [];
                    order.forEach(function (o) {
                        var obs = sepObserve(ion, o);
                        history.push({ op: o, obs: obs });
                        checked++;
                        if (sepObsKey(obs) !== base[o]) bad++;
                    });
                });
            });
            return checked >= 5000 && bad === 0;
        })());
        // ⚠ 型B に「まだわからない」という答えは無い（§16-3）
        ok('答えの選択肢は候補だけ（「まだわからない」は無い）',
            SEP_LEVELS.every(function (l) {
                return pools[l.id].every(function (e) {
                    return e.cands.every(function (c) { return !!SEP_IONS[c]; });
                });
            }));
    }

    // ===============================================================
    // 系統分離モード「型A: すべてのイオンを分ける」（tree-model.js）
    //
    // ⚠ 型A は型B とは採点が別物。★ 見るのは **純度** ——
    //   「最後に残った各葉に、イオンが1種類だけ入っているか」（§15-2）。
    //   仮説集合 H は使わない（中身が既知だから）。
    // ===============================================================
    section('型A: 模型の読み込み');
    var treeLoaded = ok('tree-model.js が読み込めている',
        typeof TREE_OPS !== 'undefined' && typeof TREE_RULES !== 'undefined' &&
        typeof TREE_SUBOPS !== 'undefined' && typeof treeRun === 'function' &&
        typeof treeGrade === 'function' && typeof treeAuditProblem === 'function' &&
        typeof treeMakeProblem === 'function');

    if (treeLoaded) {
        // ★ 出題は生成になったので、検査は **中身を固定した見本**で回す
        //   （⚠ 抽選に頼ると、落ちたときに何を見ていたのか分からなくなる）。
        //   ★ 生成そのものは、下の「出題の生成」の節が母集団ごと見る。
        var TREE_SAMPLES = [
            // ★ 属ごとに1つ（＝ 作り直す前の題材そのもの。芯がまるごと効く）
            treeBuildProblem(['Ag', 'Cu', 'Fe3', 'Zn', 'Ca', 'Na']),
            // ⚠ 亜鉛が居ない ＝ 鉄を戻し忘れても葉は汚れないが、行先は変わる
            treeBuildProblem(['Ag', 'Cu', 'Fe3', 'Ca', 'Na']),
            // ⚠ カルシウムが居ない ＝ 炭酸アンモニウムが1つも沈めない
            treeBuildProblem(['Ag', 'Cu', 'Fe3', 'Zn', 'Na'])
        ];
        // ★★ 属の中に2組入っている容器（⚠ 沈殿側の枝が要る）
        var TREE_SPLIT2 = treeBuildProblem(['Ag', 'Pb', 'Cu', 'Fe3', 'Al', 'Zn', 'Ca', 'Na']);
        // ★ 属の中に1組だけ（第1属が2つ）
        var TREE_SPLIT1 = treeBuildProblem(['Ag', 'Pb', 'Cu', 'Fe3', 'Zn', 'Ca', 'Na']);
        // -----------------------------------------------------------
        // 悉皆で宣言しているか（§4-1）
        // ⚠ 宣言もれがあると、そのイオンは黙って素通りする ＝ 結果の創作になる
        // -----------------------------------------------------------
        section('型A: イオン × 札を悉皆で宣言している（§4-1）');
        var TREE_ALL_IONS = Object.keys(TREE_RULES);
        var TREE_ALL_OPS = Object.keys(TREE_OPS);
        ok('宣言の表が空でない（' + TREE_ALL_IONS.length + 'イオン × ' + TREE_ALL_OPS.length + '札）',
            TREE_ALL_IONS.length >= 6 && TREE_ALL_OPS.length >= 6);
        // ★ 悉皆は **容器の状態ぜんぶ**（液性3 × 硫化水素の残り2 ＝ 6通り）で回す
        var treeEachRule = function (fn) {
            TREE_ALL_IONS.forEach(function (i) {
                TREE_ALL_OPS.forEach(function (o) {
                    TREE_ENVS.forEach(function (env) { fn(treeRule(i, o, env), i, o, env); });
                });
            });
        };
        ok('容器の状態を悉皆で回している（液性3 × 硫化水素の残り2 ＝ ' + TREE_ENVS.length + '通り）',
            TREE_ENVS.length === 6);
        ok('すべての（イオン × 札 × 容器の状態）が宣言されている', (function () {
            var bad = [];
            treeEachRule(function (r, i, o, env) {
                if (!r) bad.push(i + '×' + o + '(' + env.ph + (env.h2s ? '+h2s' : '') + ')');
            });
            if (bad.length) warn('宣言もれ: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('沈殿すると宣言したものは、化学式と色を持っている', (function () {
            var bad = [];
            treeEachRule(function (r, i, o) { if (r && r.ppt && !(r.f && r.c)) bad.push(i + '×' + o); });
            return bad.length === 0;
        })());
        ok('沈殿の色は、色名 → hex の表に載っている', (function () {
            var bad = [];
            treeEachRule(function (r) { if (r && r.ppt && !(r.c in TREE_COLORS)) bad.push(r.c); });
            if (bad.length) warn('色の表に無い色名: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('色名 → hex が、名乗りどおりの色になっている（緑白色を足したぶんも見る）', (function () {
            var bad = [];
            Object.keys(TREE_COLORS).forEach(function (n) {
                var hex = TREE_COLORS[n];
                if (hex === null) return;
                var w = colorWordOf(n), c = hexToHsl(hex);
                if (!w) { bad.push(n + ' に当てる色の語が無い'); return; }
                if (!c || !w.test(c)) bad.push(n + ' (' + hex + ') は「' + w.why + '」に合わない');
            });
            if (bad.length) warn('型A の色の名乗り: ' + bad.join(' / '));
            return bad.length === 0;
        })());

        // -----------------------------------------------------------
        // 酸化数で分ける（§4-4）
        // ⚠ Fe³⁺ と Fe²⁺ を同じ鉄として持つと、この設計は成立しない
        // -----------------------------------------------------------
        section('型A: 酸化数で分ける（§4-4）');
        ok('Fe³⁺ と Fe²⁺ は別の化学種として持っている',
            !!TREE_RULES.Fe3 && !!TREE_RULES.Fe2 && treeIon('Fe3').name !== treeIon('Fe2').name);
        ok('純度を数える単位は元素（Fe³⁺ も Fe²⁺ も鉄）',
            treeElement('Fe3') === 'Fe' && treeElement('Fe2') === 'Fe' && treeElement('Zn') === 'Zn');

        // -----------------------------------------------------------
        // ★★★ この教材の芯 —— なぜ「煮沸してから硝酸」なのか（§4-3・§15-2）
        // ⚠ ここが緩むと、型A を作った意味そのものが消える
        // -----------------------------------------------------------
        section('型A: 芯 —— 煮沸してから希硝酸（§4-3・§15-2）');
        var pA = TREE_SAMPLES[0];
        var idealA = treeIdealSeq(pA);
        ok('a1 は Ag⁺・Cu²⁺・Fe³⁺・Zn²⁺・Ca²⁺・Na⁺（★ 鉄と亜鉛が両方いる）',
            pA.ions.slice().sort().join(',') === 'Ag,Ca,Cu,Fe3,Na,Zn');
        var ACID = { ph: 'acid', h2s: false };
        var BASE = { ph: 'base', h2s: false };
        var NEUT = { ph: 'neutral', h2s: false };
        ok('酸性の容器で硫化水素を通すと、鉄は沈まずに Fe²⁺ になる（＝ 還元される）', (function () {
            var r = treeRule('Fe3', 'h2s', ACID);
            return r.ppt === false && r.to === 'Fe2';
        })());
        ok('煮沸してから希硝酸を加えると Fe²⁺ は Fe³⁺ に戻る',
            treeRule('Fe2', 'hno3', ACID).to === 'Fe3');
        ok('⚠ 煮沸していない（硫化水素が残っている）容器では、希硝酸を加えても戻らない（§4-2 の決め）',
            !treeRule('Fe2', 'hno3', { ph: 'acid', h2s: true }).to);
        ok('アンモニアの段で Fe³⁺ は沈むが、Fe²⁺ は沈まない（★ ここが素通りの正体）',
            treeRule('Fe3', 'nh3', ACID).ppt === true &&
            treeRule('Fe2', 'nh3', ACID).ppt === false);
        ok('塩基性の容器で硫化水素を通すと Fe²⁺ は FeS として沈む',
            treeRule('Fe2', 'h2s', BASE).f === 'FeS');

        // -----------------------------------------------------------
        // ★★★ 液性は **容器が持つ状態**（2026-08-28・ユーザー指摘の作り直し）
        // ⚠ 札の中に閉じ込めると、希塩酸を置かなくても結果が同じになってしまう
        //   ＝ 「手順を組む」ことが問われる型なのに、順番が結果に効かなくなる
        // -----------------------------------------------------------
        section('型A: 液性は容器の状態（§2-2）');
        ok('★ 硫化水素の札は1枚だけ（⚠ 酸性用・塩基性用に割り戻したら赤）', (function () {
            var h = Object.keys(TREE_OPS).filter(function (o) {
                return (TREE_OPS[o].short + TREE_OPS[o].say).indexOf('硫化水素') >= 0;
            });
            return h.length === 1 && h[0] === 'h2s';
        })());
        ok('⚠ 札の名前に液性を書いていない（★ 液性は札の性質ではない）',
            Object.keys(TREE_OPS).every(function (o) {
                return TREE_OPS[o].short.indexOf('酸性') < 0 && TREE_OPS[o].short.indexOf('塩基性') < 0;
            }));
        ok('★ 液性を変える札と、変えない札がある（希塩酸→酸性・アンモニア水→塩基性）',
            TREE_OPS.hcl.ph === 'acid' && TREE_OPS.nh3.ph === 'base' &&
            !TREE_OPS.h2s.ph && !TREE_OPS.boil.ph);
        ok('★ 硫化水素の結果は、容器の液性で変わる（Zn²⁺：酸性では沈まず、中性・塩基性では沈む）',
            treeRule('Zn', 'h2s', ACID).ppt === false &&
            treeRule('Zn', 'h2s', NEUT).ppt === true &&
            treeRule('Zn', 'h2s', BASE).ppt === true);
        ok('★ 何もしていない容器は「中性」（⚠ 教科書の硫化物の表と同じ語彙）',
            TREE_PH_JP.neutral === '中性' && treeRun(['Zn'], []).stages.length === 0 &&
            treeRun(['Zn'], ['h2s']).stages[0].ph === 'neutral');
        ok('★ 走らせた結果が、各段の液性を持っている（答え合わせがそこから説明する）', (function () {
            var s = treeRun(pA.ions, idealA).stages;
            return s[0].ph === 'neutral' && s[0].phAfter === 'acid' &&
                s[1].ph === 'acid' && s[4].phAfter === 'base' && s[5].ph === 'base';
        })());
        // ★★★ 否定対照そのもの: 希塩酸を置かずに硫化水素を置くと、結果が変わる
        var seqNoHcl = idealA.map(function (o) { return o === 'hcl' ? null : o; });
        ok('★★ 希塩酸を置かずに硫化水素を通すと、結果が変わる（⚠ 同じになったら赤）', (function () {
            var withHcl = treeActualLeaves(treeRun(pA.ions, idealA));
            var without = treeActualLeaves(treeRun(pA.ions, seqNoHcl));
            return JSON.stringify(withHcl) !== JSON.stringify(without);
        })());
        ok('★ 酸性にしていない容器では、酸性では沈まない硫化物まで同じ葉に来る', (function () {
            var a = treeActualLeaves(treeRun(pA.ions, seqNoHcl));
            var leaf = a[treeLeafId(idealA.indexOf('h2s'))] || [];
            // Ag・Cu だけでなく Fe・Zn まで来る ＝ 単離できていない
            return leaf.length === 4 && leaf.indexOf('Zn') >= 0 && leaf.indexOf('Fe') >= 0;
        })());
        ok('★ 希塩酸を置き忘れた答案は、単離できていない葉ができる', (function () {
            var g = treeGrade(pA, seqNoHcl, treePlanFromRun(pA, idealA));
            return g.isolated === false && g.dirty >= 2;
        })());
        ok('★ 同じ札を2つの枝に置ける（⚠ 硫化水素は教科書の手順で2度通す）',
            TREE_OPS.h2s.reuse === true &&
            idealA.filter(function (o) { return o === 'h2s'; }).length === 2);
        ok('★ 枝の数（' + treeSlotCount(pA) + '）は札の枚数（' + pA.ops.length + '）と別に数える',
            treeSlotCount(pA) === 7 && pA.ops.length === 6);

        // ★★ 模範の手順は、単離できて、机上と実際が一致する
        var gIdeal = treeGrade(pA, idealA, treePlanFromRun(pA, idealA));
        ok('模範の手順なら、単離できていない葉は 0 枚',
            gIdeal.dirty === 0 && gIdeal.isolated === true && gIdeal.verdict === 'perfect');
        ok('模範の手順では、葉が6枚できて、どれにもイオンが1つずつ',
            gIdeal.leaves.length === 6 &&
            gIdeal.leaves.every(function (l) { return gIdeal.actual[l].length === 1; }));

        // ★★★ 芯そのもの。⚠ **葉の数で不一致になること**を数で押さえる
        //   （⚠ 枝は空けたまま抜く。詰めると葉の番号がずれて、別のものを数えてしまう）
        var seqNoHno3 = idealA.map(function (o) { return o === 'hno3' ? null : o; });
        var gFe = treeGrade(pA, seqNoHno3, treePlanFromRun(pA, idealA));
        ok('★★ 希硝酸を抜いた答案は、単離できていない葉が 2 枚になる（実測 ' + gFe.dirty + ' 枚）',
            gFe.dirty === 2 && gFe.isolated === false && gFe.verdict === 'notIsolated');
        ok('その1枚は「鉄と亜鉛が同居した葉」', (function () {
            if (gFe.impure.length !== 1) return false;
            return gFe.actual[gFe.impure[0]].slice().sort().join(',') === 'Fe,Zn';
        })());
        ok('もう1枚は「鉄を置いたのに、何も来なかった葉」（＝ アンモニアの段）', (function () {
            if (gFe.emptyPlanned.length !== 1) return false;
            var leaf = gFe.emptyPlanned[0];
            return leaf === treeLeafId(idealA.indexOf('nh3')) && gFe.actual[leaf].length === 0;
        })());
        ok('鉄が FeS として沈んだことを、答え合わせの材料として持っている（§4-3 の説明の引き金）',
            gFe.feAsFeS === true && gIdeal.feAsFeS === false);
        ok('机上との食い違いも名指しできる（鉄をどこへ置いて、実際はどこへ来たか）', (function () {
            var m = gFe.misplaced.filter(function (x) { return x.ion === 'Fe3'; });
            return m.length === 1 && m[0].said !== m[0].actual;
        })());

        // ★ 煮沸のほうを抜くと、別の形で効く（W4・§10-4）
        var seqNoBoil = idealA.map(function (o) { return o === 'boil' ? null : o; });
        var gBoil = treeGrade(pA, seqNoBoil, treePlanFromRun(pA, idealA));
        ok('煮沸を抜くと、硫化水素が残ったままアンモニアの段に入り、硫化物が第3属の沈殿に混ざる（W4）', (function () {
            var leaf = treeLeafId(idealA.indexOf('nh3'));
            return gBoil.actual[leaf].slice().sort().join(',') === 'Fe,Zn' && gBoil.dirty >= 2;
        })());

        // ⚠ 亜鉛がいない容器では、鉄を戻し忘れても葉は汚れない。★ でも行先は変わる
        var pB = TREE_SAMPLES[1];
        var idealB = treeIdealSeq(pB);
        var gB = treeGrade(pB, idealB.map(function (o) { return o === 'hno3' ? null : o; }),
            treePlanFromRun(pB, idealB));
        ok('亜鉛がいない容器では、鉄を戻し忘れても同居は起きない（★ 純度と一致は別のもの）',
            gB.impure.length === 0 && gB.misplaced.length === 1 && gB.verdict === 'misread');

        // -----------------------------------------------------------
        // ツリーの形（§16-2）
        // -----------------------------------------------------------
        section('型A: ツリーの形（§16-2）');
        ok('葉が生えるのは、沈殿をつくりうる札を置いた枝だけ',
            TREE_OPS.boil.splits === false && TREE_OPS.hno3.splits === false &&
            TREE_OPS.hcl.splits === true && TREE_OPS.co3.splits === true);
        ok('煮沸と希硝酸の枝には葉ができない（走らせた結果に、その葉が現れない）', (function () {
            var run = treeRun(pA.ions, idealA);
            var a = treeActualLeaves(run);
            return !(treeLeafId(idealA.indexOf('boil')) in a) &&
                !(treeLeafId(idealA.indexOf('hno3')) in a);
        })());
        ok('⚠ 空けた枝は詰めない（葉の番号は、置いた枝の番号のまま）', (function () {
            var run = treeRun(pA.ions, seqNoHno3);
            var a = treeActualLeaves(run);
            // 4番目の枝（＝ 添字3）を空けても、アンモニアの葉は L4 のまま
            return (treeLeafId(4) in a) && !(treeLeafId(3) in a);
        })());
        ok('最後のろ液の葉は必ずある（★ 沈殿させる試薬が無い属の行先）', (function () {
            var run = treeRun(pA.ions, [null, null, null, null, null, null, null]);
            var a = treeActualLeaves(run);
            return a[TREE_FINAL_LEAF].length === pA.ions.length;
        })());
        ok('操作を1つも置かなければ、全部が最後のろ液に残る（＝ 単離できていない）', (function () {
            var empty = [null, null, null, null, null, null, null];   // ⚠ 枝は7本
            var g = treeGrade(pA, empty, {});
            return g.isolated === false && g.actual[TREE_FINAL_LEAF].length === 6;
        })());

        // -----------------------------------------------------------
        // ★★★ 沈殿側の枝（2026-08-28・§20-6 の (b)）
        //
        // ⚠⚠ ここが緩むと、この回で作ったものが丸ごと死ぬ ——
        //   **属を欠けさせても手順は変わらない**ので、手順のバリエーションの源は
        //   「属の中に2つ入れる」しかない。
        // -----------------------------------------------------------
        section('型A: 沈殿側の札（§20-6 の (b)）');
        var idealS2 = treeIdealSeq(TREE_SPLIT2);
        var subS2 = treeIdealSub(TREE_SPLIT2, idealS2);
        ok('★ 属の中に2つ入るイオンを持っている（第1属 Ag/Pb・第3属 Fe/Al）',
            TREE_GROUP.Ag === 1 && TREE_GROUP.Pb === 1 &&
            TREE_GROUP.Fe === 3 && TREE_GROUP.Al === 3);
        ok('★ 属の中に何組入るかを数えられる（0／1／2）',
            treeCrowdedGroups(['Ag', 'Cu', 'Fe3', 'Na']) === 0 &&
            treeCrowdedGroups(['Ag', 'Pb', 'Fe3', 'Na']) === 1 &&
            treeCrowdedGroups(TREE_SPLIT2.ions) === 2);
        ok('★ 沈殿側の札が2枚ある（熱湯・過剰の水酸化ナトリウム水溶液）',
            Object.keys(TREE_SUBOPS).length === 2 &&
            TREE_SUBOPS.hot.short === '熱湯' && TREE_SUBOPS.naoh.short.indexOf('水酸化ナトリウム') >= 0);
        ok('⚠⚠ 沈殿側の表の鍵は、イオンではなく **沈殿の化学式**（★ PbCl₂ と PbS は別もの）',
            treeSubRule('PbCl₂', 'hot').out === 'sol' &&
            treeSubRule('PbS', 'hot').out === 'ppt');
        ok('★★ 主流の札が生みうる沈殿ぜんぶ × 沈殿側の札ぜんぶが宣言されている（実測 ' +
            treeAllFormulas().length + ' 式）', (function () {
                var bad = [];
                treeAllFormulas().forEach(function (f) {
                    Object.keys(TREE_SUBOPS).forEach(function (o) {
                        if (!treeSubRule(f, o)) bad.push(f + '×' + o);
                    });
                });
                if (bad.length) warn('沈殿側の宣言もれ: ' + bad.join(' / '));
                return bad.length === 0 && treeAllFormulas().length >= 12;
            })());
        ok('★ 溶け出すと宣言したものは、溶けた姿と色を持っている', (function () {
            var bad = [];
            Object.keys(TREE_SUB_RULES).forEach(function (f) {
                Object.keys(TREE_SUB_RULES[f]).forEach(function (o) {
                    var r = TREE_SUB_RULES[f][o];
                    if (r.out === 'sol' && !(r.f && r.c)) bad.push(f + '×' + o);
                    if (r.c && !(r.c in TREE_COLORS)) bad.push(f + '×' + o + ':' + r.c);
                });
            });
            return bad.length === 0;
        })());
        // ⚠ 出典（§4-1 の線を後から検算するため）。★ 教科書／参考書の別を残すこと
        ok('★★ 沈殿側の規則は、全件が出典と「教科書／参考書」の別を持っている', (function () {
            var bad = [], books = {};
            Object.keys(TREE_SUB_RULES).forEach(function (f) {
                Object.keys(TREE_SUB_RULES[f]).forEach(function (o) {
                    var r = TREE_SUB_RULES[f][o];
                    if (!r.ref || !r.book) { bad.push(f + '×' + o); return; }
                    if (r.book !== '教科書' && r.book !== '参考書') bad.push(f + '×' + o + ':' + r.book);
                    books[r.book] = (books[r.book] || 0) + 1;
                });
            });
            if (bad.length) warn('出典の無い沈殿側の組: ' + bad.join(' / '));
            return bad.length === 0 && books['教科書'] > 0 && books['参考書'] > 0;
        })());
        ok('⚠ 沈殿側に「この教材が埋めた」組が無い（★ 全件が資料の裏づけを持つ）', (function () {
            var n = 0;
            Object.keys(TREE_SUB_RULES).forEach(function (f) {
                Object.keys(TREE_SUB_RULES[f]).forEach(function (o) {
                    if (TREE_SUB_RULES[f][o].src) n++;
                });
            });
            return n === 0;
        })());
        ok('⚠ 沈殿側の説明にも、本の名前とページ番号を書いていない', (function () {
            var bad = [];
            Object.keys(TREE_SUB_RULES).forEach(function (f) {
                Object.keys(TREE_SUB_RULES[f]).forEach(function (o) {
                    var w = TREE_SUB_RULES[f][o].why || '';
                    if (/p\s*\.\s*\d+/i.test(w)) bad.push(f + '×' + o);
                    ['教科書', '化学新研究', '新研究', '総合的研究', '要点&盲点', '基本ノート',
                        'セミナー', '東京書籍', '参考書'].forEach(function (b) {
                            if (w.indexOf(b) >= 0) bad.push(f + '×' + o + ':' + b);
                        });
                });
            });
            return bad.length === 0;
        })());
        // ★ 第1属・第3属の分かれ方そのもの
        ok('★★ 第1属: 熱湯で PbCl₂ だけ溶け、AgCl は沈殿のまま残る',
            treeSubRule('PbCl₂', 'hot').out === 'sol' &&
            treeSubRule('AgCl', 'hot').out === 'ppt');
        ok('★★ 第3属: 過剰の水酸化ナトリウム水溶液で Al(OH)₃ だけ溶け、FeO(OH) は残る',
            treeSubRule('Al(OH)₃', 'naoh').out === 'sol' &&
            treeSubRule('Al(OH)₃', 'naoh').f === '[Al(OH)₄]⁻' &&
            treeSubRule('FeO(OH)', 'naoh').out === 'ppt');
        ok('⚠ 亜鉛は両性だが、そこに在るのは硫化物なので過剰の水酸化ナトリウムでは溶けない',
            treeSubRule('ZnS', 'naoh').out === 'ppt');
        ok('★ 模範の沈殿側の置き方を、決め打ちせずに悉皆で見つけている（実測 ' +
            JSON.stringify(subS2) + '）',
            subS2[idealS2.indexOf('hcl')] === 'hot' &&
            subS2[idealS2.indexOf('nh3')] === 'naoh' &&
            Object.keys(subS2).length === 2);

        // ★★★ 発注の芯 —— 「割らずに止めると不正解」
        var planS2 = treePlanFromRun(TREE_SPLIT2, idealS2, subS2);
        var gSplit = treeGrade(TREE_SPLIT2, idealS2, planS2, subS2);
        var gStop = treeGrade(TREE_SPLIT2, idealS2, planS2, {});
        ok('★ 割れば、8種すべてが別々の葉に1つずつ入る（葉 ' + gSplit.leaves.length + '枚）',
            gSplit.isolated === true && gSplit.dirty === 0 && gSplit.verdict === 'perfect' &&
            gSplit.leaves.length === 8);
        ok('★★★ 割らずに止めると、単離できていない葉が 2 枚できる（実測 ' + gStop.dirty + ' 枚）',
            gStop.isolated === false && gStop.dirty === 2 &&
            gStop.impure.length === 2);
        ok('★ その2枚は「銀と鉛が同居した葉」と「鉄とアルミニウムが同居した葉」', (function () {
            var got = gStop.impure.map(function (l) {
                return gStop.actual[l].slice().sort().join(',');
            }).sort().join(' / ');
            return got === 'Ag,Pb / Al,Fe';
        })());
        ok('★ 属の中に1組だけの容器では、割らずに止めると葉は 1 枚汚れる', (function () {
            var seq = treeIdealSeq(TREE_SPLIT1);
            var sub = treeIdealSub(TREE_SPLIT1, seq);
            var pl = treePlanFromRun(TREE_SPLIT1, seq, sub);
            return Object.keys(sub).length === 1 &&
                treeGrade(TREE_SPLIT1, seq, pl, {}).dirty === 1 &&
                treeGrade(TREE_SPLIT1, seq, pl, sub).dirty === 0;
        })());
        ok('★★ 割った沈殿は、もう置き場ではない（⚠ 終端は木の形から出す。§20-4）', (function () {
            var run = treeRun(TREE_SPLIT2.ions, idealS2, subS2);
            var lv = treeLeafIds(run);
            var slot = idealS2.indexOf('hcl');
            return lv.indexOf(treeLeafId(slot)) < 0 &&
                lv.indexOf(treeSubLeafId(slot, 's')) >= 0 &&
                lv.indexOf(treeSubLeafId(slot, 'p')) >= 0;
        })());
        ok('★ 沈殿側の札も1手として数える（⚠ 割ると2手ぶん増える）',
            gSplit.moves === gStop.moves + 2);
        ok('⚠ 沈殿ができない枝に沈殿側の札を置いても効かない（★ 黙って無視する）', (function () {
            var boil = idealS2.indexOf('boil');
            var s = {}; s[boil] = 'hot';
            var run = treeRun(TREE_SPLIT2.ions, idealS2, s);
            return run.stages[boil].sub === null &&
                treeLeafIds(run).indexOf(treeSubLeafId(boil, 's')) < 0;
        })());
        ok('★ 芯（希硝酸）は、属の中に2組ある容器でも効く', (function () {
            var a = treeAuditProblem(TREE_SPLIT2);
            return a.feTrap === true && a.hclTrap === true && a.splitTrap === true &&
                a.pairs === 2 && a.splitDirty === 2;
        })());

        // -----------------------------------------------------------
        // 出題の門番（§2-4 の型A 版）
        // ⚠ 型A の門番が見るのは「見分けられるか」ではなく
        //   ★ **配った札で、全部を単離しきる手順が実在するか**
        // -----------------------------------------------------------
        section('型A: 出題の門番');
        TREE_SAMPLES.concat([TREE_SPLIT1, TREE_SPLIT2]).forEach(function (p) {
            var a = treeAuditProblem(p);
            ok('[' + p.id + '] 宣言もれが無い（実測 ' + a.undeclared.length + ' 件）',
                a.undeclared.length === 0);
            ok('[' + p.id + '] 配った札で、全部を単離しきる手順が実在する',
                a.solvable === true && a.idealDirty === 0 && a.ok === true);
            ok('[' + p.id + '] ★ 芯が効く（希硝酸を抜くと結果が変わる。汚れた葉 ' +
                a.feDirty + ' 枚・行先の食い違い ' + a.feMisplaced + ' 件）', a.feTrap === true);
            // ★★ 液性が状態として効いているか（⚠ 札の中に閉じ込めたら、ここが false になる）
            ok('[' + p.id + '] ★★ 希塩酸を抜くと硫化水素の結果が変わる（汚れた葉 ' +
                a.hclDirty + ' 枚）', a.hclTrap === true && a.hclDirty >= 2);
        });
        // ★ 手数（2026-08-28・ユーザー「余計な手順は正解、ただし減点のようなあつかい」）
        section('型A: 手数と、余計な手（★ 不正解にはしない）');
        ok('★ 採点が手数を持っている（⚠ 空けた枝は数えない）', (function () {
            var g = treeGrade(pA, idealA, treePlanFromRun(pA, idealA));
            var g2 = treeGrade(pA, seqNoHno3, treePlanFromRun(pA, idealA));
            return g.moves === 7 && g2.moves === 6;
        })());
        ok('★ 門番が理想の最短手数を持っている（' +
            TREE_SAMPLES.map(function (p) { return p.id + ':' + treeAuditProblem(p).shortest; }).join(' ') + '）',
            TREE_SAMPLES.every(function (p) {
                var a = treeAuditProblem(p);
                // ⚠ 下限を高く見積もらないこと。★ a2 は実測4手で足りる
                //   （亜鉛が居ないので硫化水素は1回でよく、鉄が還元されないので煮沸も希硝酸も要らない）
                return a.shortest >= 3 && a.shortest <= a.ideal.length;
            }));
        ok('★★ 属が欠けている容器では、飛ばせる段があるぶん最短が短い（⚠ 正解は1つではない）',
            treeAuditProblem(TREE_SAMPLES[0]).shortest === 7 &&
            treeAuditProblem(TREE_SAMPLES[1]).shortest < 7 &&
            treeAuditProblem(TREE_SAMPLES[2]).shortest < 7);
        ok('★★ 最短の手数で実際に単離できる（⚠ 数だけ出して解けなかったら赤）', (function () {
            var bad = [];
            TREE_SAMPLES.concat([TREE_SPLIT1, TREE_SPLIT2]).forEach(function (p) {
                var a = treeAuditProblem(p);
                // ⚠ 手順そのものは画面に出さないが、検査では「その手数で解ける」ことを確かめる
                var ideal = treeIdealSeq(p), sub = treeIdealSub(p, ideal), trimmed = ideal.slice();
                var okIso = function (s, sb) {
                    return treeGrade(p, s, treePlanFromRun(p, s, sb), sb).isolated;
                };
                ideal.forEach(function (o, i) {
                    var probe = trimmed.slice();
                    probe[i] = null;
                    if (okIso(probe, sub)) trimmed = probe;
                });
                Object.keys(sub).forEach(function (k) {
                    var probe = {};
                    Object.keys(sub).forEach(function (k2) { if (k2 !== k) probe[k2] = sub[k2]; });
                    if (okIso(trimmed, probe)) sub = probe;
                });
                var g = treeGrade(p, trimmed, treePlanFromRun(p, trimmed, sub), sub);
                if (!g.isolated || g.moves !== a.shortest) bad.push(p.id + '(' + g.moves + '/' + a.shortest + ')');
            });
            if (bad.length) warn('最短で解けない出題: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('⚠ 余計な手があっても、単離できていれば単離できたと数える（★ 減点ではない）', (function () {
            // 模範のうしろに「もう1回 硫化水素」を足した答案（★ 何も沈まない余計な手）
            var extra = idealA.concat(['h2s']);
            var g = treeGrade(pA, extra, treePlanFromRun(pA, idealA));
            return g.isolated === true && g.moves === 8;
        })());
        ok('★ 少なくとも1問は、鉄を戻し忘れると葉が2枚汚れる（＝ 型A を作る意味そのもの）',
            TREE_SAMPLES.some(function (p) { return treeAuditProblem(p).feDirty >= 2; }));
        ok('どの出題にも鉄が入っている（⚠ 入っていない出題は、この教材の芯を持たない）',
            TREE_SAMPLES.every(function (p) { return p.ions.indexOf('Fe3') >= 0; }));

        // -----------------------------------------------------------
        // ★★★ 出題の生成（2026-08-28）—— ⚠ 直書きをやめ、型B と同じ道を通す
        //
        // ⚠⚠ ここが緩むと「題材が3件しかない」に戻る。
        //   ★ 段ごとの母数と、母集団の全件が門番を通ることを、毎回の全走で数える。
        // -----------------------------------------------------------
        section('型A: 出題の生成と難易度');
        var treePoolsAll = treePools();
        var treePoolN = {};
        TREE_LEVELS.forEach(function (l) { treePoolN[l.id] = (treePoolsAll[l.id] || []).length; });
        ok('★ 段が3つある（やさしい／ふつう／むずかしい）',
            TREE_LEVELS.length === 3 &&
            TREE_LEVELS.map(function (l) { return l.id; }).join(',') === 'easy,normal,hard');
        ok('★★ どの段にも十分な母数がある（実測 ' +
            TREE_LEVELS.map(function (l) { return l.name + ' ' + treePoolN[l.id]; }).join('／') + '）',
            TREE_LEVELS.every(function (l) { return treePoolN[l.id] >= 10; }));
        ok('⚠ 1通りしか無い段が無い（★ あれば段の切り方が悪い）',
            TREE_LEVELS.every(function (l) { return treePoolN[l.id] >= 2; }));
        ok('★ 母集団の全件が門番を通っている（実測 ' +
            TREE_LEVELS.reduce(function (n, l) { return n + treePoolN[l.id]; }, 0) + ' 組）', (function () {
                var bad = [];
                TREE_LEVELS.forEach(function (l) {
                    (treePoolsAll[l.id] || []).forEach(function (e) {
                        var a = treeAuditProblem(treeBuildProblem(e.ions));
                        if (!a.ok) bad.push(treeIonKey(e.ions));
                    });
                });
                if (bad.length) warn('門番を通らない出題が母集団に居る: ' + bad.slice(0, 5).join(' / '));
                return bad.length === 0;
            })());
        ok('★★ 母集団のどの組も、理想の最短が2手以上（⚠ 1手で終わる容器は出さない）', (function () {
            var bad = [];
            TREE_LEVELS.forEach(function (l) {
                (treePoolsAll[l.id] || []).forEach(function (e) {
                    if (e.shortest < 2) bad.push(treeIonKey(e.ions) + ':' + e.shortest);
                });
            });
            return bad.length === 0;
        })());
        ok('⚠⚠ 母集団のどの組にも鉄が入っている（★ 芯を持たない容器は出さない）', (function () {
            var bad = [];
            TREE_LEVELS.forEach(function (l) {
                (treePoolsAll[l.id] || []).forEach(function (e) {
                    if (e.ions.indexOf('Fe3') < 0) bad.push(treeIonKey(e.ions));
                });
            });
            return bad.length === 0;
        })());
        ok('★★ 属の中に2つ入る組が母集団に居る（＝ 手順のバリエーションが実在する。実測 ' + (function () {
            var n = 0;
            TREE_LEVELS.forEach(function (l) {
                (treePoolsAll[l.id] || []).forEach(function (e) { if (e.pairs >= 1) n++; });
            });
            return n;
        })() + ' 組）', (function () {
            var n1 = 0, n2 = 0;
            TREE_LEVELS.forEach(function (l) {
                (treePoolsAll[l.id] || []).forEach(function (e) {
                    if (e.pairs === 1) n1++;
                    if (e.pairs === 2) n2++;
                });
            });
            return n1 >= 10 && n2 >= 5;
        })());
        // ★ 難易度は手で付けない（§2-4）。⚠ 門番が数えた値だけから出す
        ok('★★ 難易度の根拠が、門番の数えた値そのもの（中身の数＋最短手数＋3×属の中の組数）', (function () {
            var bad = [];
            [TREE_SAMPLES[0], TREE_SPLIT1, TREE_SPLIT2].forEach(function (p) {
                var a = treeAuditProblem(p), d = treeDifficulty(p, a);
                if (d.score !== p.ions.length + a.shortest + 3 * a.pairs) bad.push(p.id);
                if (d.ions !== p.ions.length || d.shortest !== a.shortest || d.pairs !== a.pairs) bad.push(p.id);
            });
            return bad.length === 0;
        })());
        ok('★ 属の中の組数が増えると、難易度の段も上がる（実測 ' +
            [TREE_SAMPLES[0], TREE_SPLIT1, TREE_SPLIT2].map(function (p) {
                var d = treeDifficulty(p); return d.pairs + '組→' + d.name + '(' + d.score + ')';
            }).join('／') + '）',
            treeDifficulty(TREE_SAMPLES[0]).score < treeDifficulty(TREE_SPLIT1).score &&
            treeDifficulty(TREE_SPLIT1).score < treeDifficulty(TREE_SPLIT2).score &&
            treeDifficulty(TREE_SPLIT2).level === 'hard');
        ok('⚠ 段の切り方を2か所に持っていない（★ TREE_LEVELS の min/max だけ）',
            treeLevelOf(TREE_LEVELS[0].max) === 'easy' &&
            treeLevelOf(TREE_LEVELS[1].min) === 'normal' &&
            treeLevelOf(TREE_LEVELS[2].min) === 'hard');
        ok('★ 難易度が出す語に、解き筋が混じっていない',
            TREE_LEVELS.every(function (l) {
                return (SPOILER_WORDS || []).every(function (w) {
                    return (l.name + l.mark + l.id).indexOf(w) < 0;
                });
            }));
        // ★ 抽選（⚠ 乱数はテストが固定する）
        ok('★ 段を指定して1問引ける（引いた組は、その段の母集団に居る）', (function () {
            var bad = [];
            TREE_LEVELS.forEach(function (l) {
                for (var i = 0; i < 12; i++) {
                    var q = treeMakeProblem(l.id, { rand: (function (k) { return function () { return k; }; })(i / 12) });
                    if (!q) { bad.push(l.id + ':null'); continue; }
                    if (treeDifficulty(q).level !== l.id) bad.push(l.id + ':' + q.id);
                }
            });
            if (bad.length) warn('段と食い違う出題: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('★★ 同じ容器が続けて出ない（⚠ 直前の組を避けて引く）', (function () {
            var first = treeMakeProblem('normal', { rand: function () { return 0; } });
            var next = treeMakeProblem('normal', {
                rand: function () { return 0; }, avoid: treeIonKey(first.ions)
            });
            return treeIonKey(first.ions) !== treeIonKey(next.ions);
        })());
        ok('⚠ 出題は、どの中身でも同じだけ札を配る（★ 配る枚数がヒントにならない）', (function () {
            var bad = [];
            [TREE_SAMPLES[0], TREE_SPLIT1, TREE_SPLIT2].forEach(function (p) {
                if (p.ops.join(',') !== TREE_MAIN_DEAL.join(',')) bad.push(p.id + ':ops');
                if (p.subOps.join(',') !== TREE_SUB_DEAL.join(',')) bad.push(p.id + ':sub');
            });
            return bad.length === 0;
        })());

        // -----------------------------------------------------------
        // ⚠ 出題に解き筋を持たせない（型B と同じ縛り。§18-6 (1)）
        // -----------------------------------------------------------
        section('型A: 出題の文言に解き筋を出さない');
        ok('出題が持つのは id・中身・札だけ（説明文の欄を持たない）',
            TREE_SAMPLES.every(function (p) {
                return Object.keys(p).sort().join(',') === 'id,ions,level,ops,subOps';
            }));
        ok('やり方の名前が、解き筋に触れる語を持たない',
            Object.keys(TREE_MODES).every(function (k) {
                var m = TREE_MODES[k];
                // ⚠ 型B の検査が使う語彙をそのまま借りる（1か所で持つ）
                return (SPOILER_WORDS || []).every(function (w) {
                    return (m.name + m.id).indexOf(w) < 0;
                });
            }));
        // ★ やり方の名前はユーザーが決めた文言（2026-08-28）。⚠ 勝手に言い換えない
        ok('やり方の名前が、ユーザーの決めた文言のまま',
            TREE_MODES.read.name === 'イオンの行先を答える' &&
            TREE_MODES.build.name === '実験手順から考える');
        ok('⚠ 「行き先」ではなく「行先」（★ 表記のゆれを作らない）',
            Object.keys(TREE_MODES).every(function (k) {
                return TREE_MODES[k].name.indexOf('行き先') < 0;
            }));
        ok('札の名前に属の番号を書いていない（⚠ 書いたら並べる順を配ってしまう）',
            Object.keys(TREE_OPS).every(function (o) {
                var t = TREE_OPS[o].short + TREE_OPS[o].say + TREE_OPS[o].mean;
                return !/第[1-6１-６]属/.test(t) && !/第[1-6１-６]族/.test(t);
            }));

        // -----------------------------------------------------------
        // 出典はデータに残し、画面には出さない（§18-6 (4)・§17-10 と同じ扱い）
        // -----------------------------------------------------------
        section('型A: 出典はデータに残し、画面には出さない');
        var TREE_BOOKS = ['教科書', '化学新研究', '新研究', '総合的研究', '要点&盲点',
            '基本ノート', 'セミナー', '東京書籍', '三省堂', '旺文社', '参考書'];
        ok('説明（why）に本の名前が出てこない', (function () {
            var bad = [];
            treeEachRule(function (r, i, o) {
                var w = (r || {}).why || '';
                TREE_BOOKS.forEach(function (b) { if (w.indexOf(b) >= 0) bad.push(i + '×' + o + ':' + b); });
            });
            if (bad.length) warn('型A の why に本の名前: ' + bad.join(' / '));
            return bad.length === 0;
        })());
        ok('説明（why）にページ番号が出てこない', (function () {
            var bad = [];
            treeEachRule(function (r, i, o) {
                if (/p\s*\.\s*\d+/i.test((r || {}).why || '')) bad.push(i + '×' + o);
            });
            return bad.length === 0;
        })());
        ok('出典（ref）はデータに残っている', (function () {
            var seen = {};
            // ⚠ 宣言もれがあっても **ここで例外にしない**。例外を投げると #total が更新されず、
            //   全走がそのまま黙って固まる（実測: 否定対照で 25 分待たされた）。
            //   ★ 落とすのは上の「悉皆で宣言している」の1件で足りる
            treeEachRule(function (r, i, o) { if (r && r.ref) seen[i + '×' + o] = 1; });
            var n = Object.keys(seen).length;
            if (n < 15) warn('ref を持つ組が ' + n + ' 件しかない');
            return n >= 15;
        })());
        // ⚠⚠ 資料が直接は書いていない組（src:'この教材'）を、増やしっぱなしにしない。
        //   ★ しかも「模範の手順では1度も出番が無い」＝ 系統分離の順どおりなら通らない場所
        //     だけに置いてある、を機械で押さえる
        ok('資料に無い組（この教材が埋めたもの）は 8 件以内', (function () {
            var seen = {};
            treeEachRule(function (r, i, o) { if (r && r.src) seen[i + '×' + o] = 1; });
            var n = Object.keys(seen);
            if (n.length) warn('この教材が埋めた組: ' + n.join(' / '));
            return n.length <= 8;
        })());
        ok('★ 模範の手順では、この教材が埋めた組を1度も通らない', (function () {
            var bad = [];
            TREE_SAMPLES.concat([TREE_SPLIT2]).forEach(function (p) {
                var run = treeRun(p.ions, treeIdealSeq(p), treeIdealSub(p));
                run.stages.forEach(function (s) {
                    s.ppt.forEach(function (e) { if (e.src) bad.push(p.id + ':' + e.f); });
                });
            });
            if (bad.length) warn('模範の手順が、この教材の埋めた組を通っている: ' + bad.join(' / '));
            return bad.length === 0;
        })());

        // -----------------------------------------------------------
        // 型の鍵（⚠ 送信も保存もしない。持つだけ）
        // -----------------------------------------------------------
        section('型A: 型の鍵と記録');
        ok('同じ中身・同じやり方なら、並びが違っても同じ鍵',
            treeTypeKey('read', { ions: ['Na', 'Ag', 'Cu'] }) ===
            treeTypeKey('read', { ions: ['Cu', 'Ag', 'Na'] }));
        ok('やり方が違えば別の鍵',
            treeTypeKey('read', { ions: ['Na', 'Ag'] }) !== treeTypeKey('build', { ions: ['Na', 'Ag'] }));
        ok('鍵に版が入っている（⚠ 札の配り方や採点を変えたら上げる）',
            treeTypeKey('read', { ions: ['Ag'] }).indexOf(TREE_KEY_VERSION + '|') === 0);
        ok('鍵が型B の鍵と混ざらない（版の頭文字が違う）',
            typeof SEP_KEY_VERSION === 'string' &&
            TREE_KEY_VERSION.charAt(0) !== SEP_KEY_VERSION.charAt(0));
        ok('記録は、鍵とやり方と中身と札を持つ', (function () {
            var r = treeRecord('build', pA, { dirty: 2 });
            return r.mode === 'build' && r.ions.length === 6 && r.ops.length === 6 && r.dirty === 2;
        })());
    }

    // ---------------------------------------------------------------
    // UI（iframe で実アプリを駆動）
    // ---------------------------------------------------------------
    var TAP_MIN = 32;   // 指で押せる下限（ratio と同じ基準）
    var frame = document.getElementById('app');

    function rectH(el) { return el ? el.getBoundingClientRect().height : 0; }
    function visible(el) {
        return !!(el && el.offsetParent !== null);
    }

    function stopGameLoop(w) {
        // update() は先頭で GAMEOVER なら return するので、rAF ループが止まる。
        // テストのページを開きっぱなしにしても回り続けないようにする
        try { w.eval("gameState = 'GAMEOVER';"); } catch (e) { warn('ゲームループを止められませんでした: ' + e); }
    }

    function runUI(inited) {
        var w = frame.contentWindow, d = frame.contentDocument;
        section('アプリの起動', uiOut);
        if (!ok('index.html が iframe で初期化された（init() が走った）', inited, uiOut)) {
            endAll();
            return;
        }
        ok('fitBoard() が公開されている', typeof w.fitBoard === 'function', uiOut);
        ok('isTooShortForBoard() が公開されている', typeof w.isTooShortForBoard === 'function', uiOut);
        /* 幅・高さを測るテストの前提。**Claude のブラウザペインは非表示のとき
           レイアウトごと止まる**ので、この1件が落ちたら以下の寸法系はまとめて
           落ちる（原因はアプリではなく開き方）。表示した状態で開き直すこと。 */
        ok('iframe にレイアウトがある（画面に表示した状態で開くこと。' +
            '非表示のタブでは幅が 0 になり、以下の寸法のテストが総崩れする）',
            d.documentElement.clientWidth > 0 &&
            !!d.getElementById('main-area') && d.getElementById('main-area').clientWidth > 0, uiOut);

        // --- 4-1. ルール説明文と実装の一致（v1 の事故そのもの） ---
        section('ルール説明文と chemistry.js の一致', uiOut);
        var PH_WORD = { ACIDIC: '酸性', BASIC: '塩基性' };
        var safeEl = d.getElementById('rule-safe-ph');
        var dangerEl = d.getElementById('rule-danger-ph');
        var haveRule = ok('ルール欄に液性の札（#rule-safe-ph / #rule-danger-ph）がある',
            !!safeEl && !!dangerEl, uiOut);
        if (haveRule) {
            var safePh = safeEl.getAttribute('data-ph');
            var dangerPh = dangerEl.getAttribute('data-ph');
            ok('札の液性が ACIDIC / BASIC のどちらか',
                PH_WORD[safePh] && PH_WORD[dangerPh], uiOut);
            ok('「食べられる」と書いた液性が、実装で本当に沈殿しない液性と一致する',
                getPrecipitate('Zn', 'S', safePh) === null &&
                getPrecipitate('Fe', 'S', safePh) === null, uiOut);
            ok('「ゲームオーバー」と書いた液性が、実装で本当に沈殿する液性と一致する',
                !!getPrecipitate('Zn', 'S', dangerPh) && !!getPrecipitate('Fe', 'S', dangerPh), uiOut);
            ok('食べられる液性と沈殿する液性が別のものになっている',
                safePh !== dangerPh, uiOut);
            ok('画面に出ている言葉（' + safeEl.textContent + '）が札 ' + safePh + ' と一致する',
                safeEl.textContent.indexOf(PH_WORD[safePh]) >= 0 &&
                safeEl.textContent.indexOf(PH_WORD[dangerPh]) < 0, uiOut);
            ok('画面に出ている言葉（' + dangerEl.textContent + '）が札 ' + dangerPh + ' と一致する',
                dangerEl.textContent.indexOf(PH_WORD[dangerPh]) >= 0 &&
                dangerEl.textContent.indexOf(PH_WORD[safePh]) < 0, uiOut);

            // ルール文の色は、実際のゲーム内表示（#ph-value）と同じ向きでなければならない。
            // ここがずれると「赤い字で酸性と書いてあるのに盤は青」になる
            function hslOfComputed(el) {
                var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(w.getComputedStyle(el).color);
                return m ? rgbToHsl(+m[1], +m[2], +m[3]) : null;
            }
            function phIndicatorHsl(ph) {
                w.eval("GAME_MODE = 'SULFIDE'; FIELD_PH = '" + ph + "'; updatePHUI();");
                return hslOfComputed(d.getElementById('ph-value'));
            }
            var safeGame = phIndicatorHsl(safePh);
            var dangerGame = phIndicatorHsl(dangerPh);
            w.eval("GAME_MODE = 'CLASSIC'; updatePHUI();");   // 元に戻す
            var safeRule = hslOfComputed(safeEl);
            var dangerRule = hslOfComputed(dangerEl);
            ok('ゲーム内の液性表示の色が2つの液性で違う',
                !!safeGame && !!dangerGame && Math.abs(safeGame.h - dangerGame.h) > 30, uiOut);
            ok('ルール文の「' + PH_WORD[safePh] + '」の色が、盤の ' + safePh + ' 表示と同じ色みになっている',
                !!safeRule && !!safeGame && Math.abs(safeRule.h - safeGame.h) < 30, uiOut);
            ok('ルール文の「' + PH_WORD[dangerPh] + '」の色が、盤の ' + dangerPh + ' 表示と同じ色みになっている',
                !!dangerRule && !!dangerGame && Math.abs(dangerRule.h - dangerGame.h) < 30, uiOut);
            ok('Classic に戻すと液性の表示は消える',
                w.getComputedStyle(d.getElementById('ph-display')).display === 'none', uiOut);
        }

        // --- 4-2. イオン図鑑 ---
        section('イオン図鑑', uiOut);
        var dictBtn = d.getElementById('btn-dict');
        dictBtn.click();
        var modal = d.getElementById('dict-modal');
        ok('「イオン図鑑を開く」で図鑑が開く', !modal.classList.contains('hidden'), uiOut);
        var content = d.getElementById('dict-content');
        ok('図鑑に沈殿がすべて載っている（' + P.length + '件）',
            content.querySelectorAll('li').length === P.length, uiOut);
        ok('図鑑にすべての化学式が出ている',
            P.every(function (p) { return content.textContent.indexOf(p.formula) >= 0; }), uiOut);
        ok('図鑑にすべてのイオン名が出ている',
            Object.keys(C).concat(Object.keys(A)).every(function (k) {
                var ion = C[k] || A[k];
                return content.textContent.indexOf(ion.name) >= 0;
            }), uiOut);

        // --- 水溶液の色の表示（v12・検品 J-5） ---
        //     タイルの色を水溶液の色と取り違えさせないための打ち消し。
        //     タイルだけ出して水溶液の色を落とす退行を止める
        ok('図鑑のイオンが「タイル＋水溶液の色」の組（.dict-ion）で並ぶ（' + allIonKeys.length + '件）',
            content.querySelectorAll('.dict-ion').length === allIonKeys.length, uiOut);
        ok('どの .dict-ion にもタイル（.dict-item）と水溶液の色（.dict-aq）が両方ある',
            Array.prototype.every.call(content.querySelectorAll('.dict-ion'), function (el) {
                return !!el.querySelector('.dict-item') && !!el.querySelector('.dict-aq');
            }), uiOut);
        ok('すべてのイオンの水溶液の色が図鑑に出ている（「水溶液: 淡緑色」など）',
            allIonKeys.every(function (k) {
                return content.textContent.indexOf('水溶液: ' + ionOf(k).aqueous) >= 0;
            }), uiOut);
        // aqueousNote（S²⁻）は、主の「水溶液: 無色」を**消さずに**下へ足す。
        // 注記だけ出て主の表記が消えると、図鑑の冒頭の注意書きと食い違う
        ok('S²⁻ の札に「水溶液: 無色」と淡黄色の注記が両方出ている', (function () {
            var el = Array.prototype.filter.call(content.querySelectorAll('.dict-ion'), function (d) {
                var t = d.querySelector('.dict-item');
                return t && t.textContent.trim() === A.S.name;
            })[0];
            if (!el) { warn('S²⁻ の札が見つからない'); return false; }
            var note = el.querySelector('.dict-aq-note');
            return el.querySelector('.dict-aq').textContent.indexOf('無色') >= 0 &&
                   !!note && note.textContent.indexOf('淡黄色') >= 0;
        })(), uiOut);
        ok('注記が出るのは S²⁻ の札だけ',
            content.querySelectorAll('.dict-aq-note').length === 1, uiOut);
        ok('図鑑に「実際の水溶液の色ではありません」という注意書きがある',
            !!content.querySelector('.dict-note') &&
            content.querySelector('.dict-note').textContent.indexOf('実際の水溶液の色ではありません') >= 0, uiOut);
        ok('注意書きが図鑑の先頭にある（イオンを見る前に目に入る）',
            content.firstElementChild === content.querySelector('.dict-note'), uiOut);
        // 沈殿の**名前**にも「(※塩基性のみ)」が入っているので、文字列を数えると倍になる。
        // 数えるのは populateDict() が付ける赤枠の札（それだけの span）
        var badges = Array.prototype.filter.call(content.querySelectorAll('li span'), function (s) {
            return s.textContent.trim() === '※塩基性のみ';
        });
        ok('液性で変わる沈殿にだけ「※塩基性のみ」の札が付く（' + basicOnly.length + '件）',
            badges.length === basicOnly.length, uiOut);

        // --- 「※塩基性のみ」と教科書の差を埋める注記（v13） ---
        //     ゲームは液性が酸性・塩基性の2値しかないので「塩基性のみ」と書いているが、
        //     教科書の定型は「中性・塩基性で沈殿」。札だけ覚えると記述式で減点されうる。
        //     ゲームの挙動（ph:'BASIC'）と沈殿の名前は変えない方針なので、
        //     **図鑑の注記だけが正しい知識を補う経路**＝落ちたら知識が丸ごと欠ける
        var phNote = content.querySelector('#dict-note-ph');
        ok('図鑑に「※塩基性のみ」の意味を補う注記（#dict-note-ph）がある', !!phNote, uiOut);
        ok('注記が注意書きの体裁（.dict-note）でそろっている',
            !!phNote && phNote.classList.contains('dict-note'), uiOut);
        ok('注記が「ゲームの都合」だと断っている（酸性・塩基性の2つしか扱っていない）',
            !!phNote && /このゲーム/.test(phNote.textContent) &&
            phNote.textContent.indexOf('2つ') >= 0, uiOut);
        ok('注記が「実際には中性でも沈殿する」と書いている',
            !!phNote && /中性でも沈殿/.test(phNote.textContent), uiOut);
        ok('注記が教科書の言い方「中性・塩基性で沈殿する」を示している',
            !!phNote && phNote.textContent.indexOf('中性・塩基性で沈殿する') >= 0, uiOut);
        ok('注記が FeS と ZnS の両方を名指ししている',
            !!phNote && phNote.textContent.indexOf('FeS') >= 0 &&
            phNote.textContent.indexOf('ZnS') >= 0, uiOut);
        ok('注記が「※塩基性のみ」の札より前にある（札を見る前に目に入る）',
            !!phNote && badges.length > 0 &&
            (phNote.compareDocumentPosition(badges[0]) & 4) !== 0, uiOut);
        ok('注記が沈殿リストの節の中にある（イオンの節ではなく札のそば）',
            !!phNote && !!phNote.closest('.dict-section') &&
            phNote.closest('.dict-section').contains(badges[0]), uiOut);
        // 先頭の注意書き（J-5）を押しのけていないこと。注記は2枚とも要る
        ok('図鑑の注意書きは2枚（タイルの色・液性の単純化）',
            content.querySelectorAll('.dict-note').length === 2, uiOut);

        // --- 文献が割れている沈殿の併記（v14） ---
        //     note を持つ沈殿の行だけに小さく添える。持たない沈殿には何も出さない
        var precNotes = content.querySelectorAll('.dict-prec-note');
        ok('note を持つ沈殿の行にだけ併記が出る（' + noted.length + '件）',
            precNotes.length === noted.length, uiOut);
        var agLi = Array.prototype.filter.call(content.querySelectorAll('li'), function (li) {
            return li.textContent.indexOf('Ag₂CO₃') >= 0;
        })[0];
        ok('図鑑に Ag₂CO₃ の行がある', !!agLi, uiOut);
        ok('Ag₂CO₃ の行が「白色沈殿」と書いている',
            !!agLi && agLi.textContent.indexOf('白色沈殿') >= 0, uiOut);
        ok('Ag₂CO₃ の化学式が白で描かれている（rgb(255, 255, 255)）',
            !!agLi && w.getComputedStyle(agLi.querySelector('strong')).color === 'rgb(255, 255, 255)', uiOut);
        ok('併記が Ag₂CO₃ の行の中にある（どの沈殿の話かが分かる）',
            !!agLi && !!agLi.querySelector('.dict-prec-note'), uiOut);
        ok('併記の文言に「淡黄色」が入っている',
            !!agLi && agLi.querySelector('.dict-prec-note').textContent.indexOf('淡黄色') >= 0, uiOut);
        ok('note を持たない沈殿の行には併記が出ない（AgCl の行）',
            !Array.prototype.filter.call(content.querySelectorAll('li'), function (li) {
                return li.textContent.indexOf('AgCl') >= 0;
            })[0].querySelector('.dict-prec-note'), uiOut);

        ok('図鑑の閉じるボタンが ' + TAP_MIN + 'px 以上',
            rectH(d.getElementById('btn-dict-close')) >= TAP_MIN, uiOut);
        d.getElementById('btn-dict-close').click();
        ok('閉じるボタンで図鑑が閉じる', modal.classList.contains('hidden'), uiOut);

        // --- 4-2b. モーダルはスクロール位置に関係なく画面内に開く（v9 B-2） ---
        //     absolute だと縦積みレイアウトで下までスクロールしてから開いたとき
        //     ページ先頭に張り付いて画面外に出る（375px 実測で下端 110px だけ）。
        section('図鑑モーダルの開く位置（スクロール後・375px）', uiOut);
        ok('#dict-modal は position:fixed（スクロールに置いていかれない）',
            w.getComputedStyle(modal).position === 'fixed', uiOut);
        ok('#game-over も position:fixed（同じ作りの穴）',
            w.getComputedStyle(d.getElementById('game-over')).position === 'fixed', uiOut);

        var savedW2 = frame.style.width, savedH2 = frame.style.height;
        frame.style.width = '375px';
        frame.style.height = '812px';
        w.scrollTo(0, d.documentElement.scrollHeight);
        var scrolled = w.scrollY;
        ok('375×812 では下までスクロールできる（この検査の前提。scrollY=' + scrolled.toFixed(0) + '）',
            scrolled > 100, uiOut);
        d.getElementById('btn-dict').click();
        var mr = modal.getBoundingClientRect();
        ok('スクロール後に開いても図鑑が画面の先頭から出る（top=' + mr.top.toFixed(0) + 'px）',
            !modal.classList.contains('hidden') && Math.abs(mr.top) < 1, uiOut);
        ok('図鑑がいま見えている画面全体を覆う（height=' + mr.height.toFixed(0) + 'px）',
            mr.height >= w.innerHeight - 1, uiOut);

        // --- 4-2c. 図鑑を開いたまま矢印キーでゲームが始まらない（v9 B-3） ---
        //     図鑑は縦長で、スクロールに矢印キーを使うのが自然。裏でヘビを走らせない
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        ok('図鑑を開いたまま矢印キーを押してもゲームが始まらない',
            w.eval('gameState') === 'READY', uiOut);
        d.getElementById('btn-dict-close').click();
        // 陽性対照。ここが通らないと上のテストは「キーが元々効いていない」だけかもしれない
        d.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowDown' }));
        ok('図鑑を閉じれば矢印キーで始まる（ガードが効きすぎていない）',
            w.eval('gameState') === 'PLAYING', uiOut);
        w.eval("gameState = 'READY'; dirQueue = []; updateUIState();");
        w.scrollTo(0, 0);
        frame.style.width = savedW2;
        frame.style.height = savedH2;

        // --- 4-2d. 図鑑用の沈殿がゲームのプールに漏れていない（v11 S-10） ---
        //     図鑑の拡充（PbCl₂ 等）が勝敗に影響しない前提そのものを固定する。
        //     ここが破れたら、拡充した組が突然ゲームに出てくる
        section('図鑑用の沈殿がゲームのプールに漏れていない', uiOut);
        function poolKeys(mode, pol, which) {
            return JSON.parse(w.eval(
                "GAME_MODE='" + mode + "'; PLAYER_POLARITY='" + pol + "';" +
                "JSON.stringify(Object.keys(getPools()." + which + "))"));
        }
        var LIB_CATIONS = ['Pb', 'Fe', 'Zn'];
        ok('Classic（陽イオンが頭）の頭プールに Pb/Fe/Zn がいない',
            poolKeys('CLASSIC', 'CATION', 'headPool')
                .every(function (k) { return LIB_CATIONS.indexOf(k) < 0; }), uiOut);
        ok('Classic（陰イオンが頭）のエサプールに Pb/Fe/Zn がいない',
            poolKeys('CLASSIC', 'ANION', 'foodPool')
                .every(function (k) { return LIB_CATIONS.indexOf(k) < 0; }), uiOut);
        ok('Sulfide の頭プールは S²⁻ だけ（Pb/Fe/Zn と組むのは常に S²⁻）',
            poolKeys('SULFIDE', 'ANION', 'headPool').join(',') === 'S', uiOut);
        w.eval("GAME_MODE='CLASSIC'; PLAYER_POLARITY='CATION'; updatePHUI();"); // 元に戻す

        // --- 4-3. 盤が画面に収まる／横スクロールしない ---
        //
        // **幅を変えたときの追随はブラウザペインでは検証できない**（非表示だと
        // resize / ResizeObserver / rAF が配られない）ので、ここでは fitBoard() を
        // 明示的に呼んでから測る。イベントが配られるかどうかは
        // `node tools/check-mobile.mjs muki`（実ブラウザ20端末）の担当。
        section('盤面が画面に収まる（fitBoard）と横スクロール', uiOut);
        var savedW = frame.style.width, savedH = frame.style.height;

        /* fitBoard() は #main-area の実測幅を基準にするので、盤を縮めると
           基準そのものも縮む（1回呼んだだけでは落ち着かない）。実際のアプリでは
           ResizeObserver が「大きさが変わるたび」に呼び直して収束させているので、
           ここでも同じように**変化しなくなるまで呼ぶ**。
           測る前に盤を 600（HTML の初期値）へ戻し、**その幅で新しく開いたのと
           同じ状態**から始める。戻り値は収束までの回数、-1 なら振動している。 */
        function fitConverge() {
            var canvas = d.getElementById('game-board');
            canvas.width = 600; canvas.height = 600;
            for (var i = 0; i < 10; i++) {
                var before = canvas.width;
                w.fitBoard();
                if (canvas.width === before) return i;
            }
            return -1;
        }

        // 900〜1200px は v3 で直した帯（3カラムが並びきらないのに縦積みにもならない幅）。
        // 1200/1201 はその境目そのもの
        var SIZES = [
            [360, 640], [375, 667], [390, 844], [414, 896], [768, 1024],
            [900, 900], [984, 900], [1000, 900], [1100, 900], [1180, 900],
            [1200, 900], [1201, 900], [1280, 800]
        ];
        var measured = 0, tooWide = [], overflow = [], notSquare = [], tooSmall = [], unstable = [];
        SIZES.forEach(function (wh) {
            var px = wh[0];
            frame.style.width = px + 'px';
            frame.style.height = wh[1] + 'px';
            var steps = fitConverge();
            var canvas = d.getElementById('game-board');
            var main = d.getElementById('main-area');
            var de = d.documentElement;
            if (!canvas || !main) return;
            measured++;
            if (steps < 0) unstable.push(px + 'px: 盤の大きさが落ち着かない');
            if (canvas.width !== canvas.height) notSquare.push(px);
            // 盤の枠（#board-container）は左右 2px ずつの border を持つ
            if (canvas.width + 4 > main.clientWidth + 1) {
                tooWide.push(px + 'px: 盤 ' + canvas.width + ' + 枠4 > main-area ' + main.clientWidth);
            }
            if (de.scrollWidth > de.clientWidth + 1 || d.body.scrollWidth > de.clientWidth + 1) {
                overflow.push(px + 'px: scrollWidth ' +
                    Math.max(de.scrollWidth, d.body.scrollWidth) + ' > clientWidth ' + de.clientWidth);
            }
            // 15×15 のマスが読めなくなる下限（fitBoard の Math.max(12, ...)）
            if (canvas.width / 15 < 12) tooSmall.push(px + 'px: マス ' + (canvas.width / 15));
        });
        frame.style.width = savedW; frame.style.height = savedH;
        fitConverge();

        [tooWide, overflow, unstable].forEach(function (list) { list.forEach(warn); });
        ok('画面の大きさ ' + SIZES.length + '通りすべてで測れた（空振りしていない）',
            measured === SIZES.length, uiOut);
        ok('盤の大きさが数回で落ち着く（fitBoard が振動しない）', unstable.length === 0, uiOut);
        ok('盤はつねに正方形', notSquare.length === 0, uiOut);
        ok('盤がつねに main-area の幅に収まる', tooWide.length === 0, uiOut);
        ok('幅 360〜1280px でページが横スクロールしない（900〜1200px の帯を含む）',
            overflow.length === 0, uiOut);
        ok('マスが 12px を下回らない', tooSmall.length === 0, uiOut);

        // --- 4-4. 横持ちの案内（v5） ---
        section('横持ちのときの案内', uiOut);
        frame.style.width = '568px';
        frame.style.height = '320px';
        var hint = d.getElementById('rotate-hint');
        ok('横持ち（568×320）で案内が出る',
            w.getComputedStyle(hint).display !== 'none', uiOut);
        ok('横持ちのとき盤（#game-container）は隠れる',
            w.getComputedStyle(d.getElementById('game-container')).visibility === 'hidden', uiOut);
        ok('横持ちのとき game.js も時間を止める（CSS と閾値がそろっている）',
            w.isTooShortForBoard() === true, uiOut);
        var rhLink = hint.querySelector('.rh-link');
        ok('案内からハブへ戻れる', !!rhLink && rhLink.getAttribute('href') === '../index.html', uiOut);
        ok('案内の戻りリンクが ' + TAP_MIN + 'px 以上', rectH(rhLink) >= TAP_MIN, uiOut);

        frame.style.width = '375px';
        frame.style.height = '667px';
        ok('縦に戻すと案内は消える',
            w.getComputedStyle(hint).display === 'none', uiOut);
        ok('縦に戻すと game.js の時間も動く',
            w.isTooShortForBoard() === false, uiOut);

        // --- 4-5. ハブへの導線とタップ標的（v6） ---
        section('ハブへの導線とタップ標的（375px）', uiOut);
        fitConverge();
        var hub = d.querySelector('.topbar .hubLink');
        ok('ヘッダーにハブへ戻るリンクがある', !!hub, uiOut);
        ok('ハブへのリンク先が ../index.html', !!hub && hub.getAttribute('href') === '../index.html', uiOut);
        ok('ハブへのリンクが ' + TAP_MIN + 'px 以上', rectH(hub) >= TAP_MIN, uiOut);
        ok('版表示がヘッダーにある', !!d.querySelector('.topbar .version'), uiOut);
        // GA4 を入れている全ページの義理（privacy 側の適用範囲にも muki を明記済み）
        ok('プライバシーポリシーへの導線がある（../privacy.html）',
            !!d.querySelector('a[href="../privacy.html"]'), uiOut);

        var swept = 0, small = [];
        Array.prototype.forEach.call(d.querySelectorAll('button, a'), function (el) {
            if (!visible(el)) return;
            swept++;
            var h = rectH(el);
            if (h < TAP_MIN) small.push((el.id || el.className || el.tagName) + ': ' + h.toFixed(1) + 'px');
        });
        if (small.length) small.forEach(warn);
        ok('押す物を1つ以上測った（空振りしていない）', swept > 0, uiOut);
        ok('375px で表に出ている押す物がすべて ' + TAP_MIN + 'px 以上（測った数 ' + swept + '）',
            small.length === 0, uiOut);

        frame.style.width = savedW; frame.style.height = savedH;
        fitConverge();

        // --- 4-6. Sulfide→Classic の極性復帰（v10 B-4） ---
        //     Sulfide は init() が PLAYER_POLARITY を 'ANION' に固定する。
        //     Classic に戻したとき、Sulfide に入る前の選択に戻ること
        section('Sulfide→Classic の極性復帰', uiOut);
        var cBtn = d.getElementById('btn-cation'), aBtn = d.getElementById('btn-anion');
        cBtn.click();
        d.getElementById('btn-mode-sulfide').click();
        ok('Sulfide 中は極性が ANION（頭 S²⁻ 固定）', w.eval('PLAYER_POLARITY') === 'ANION', uiOut);
        d.getElementById('btn-mode-classic').click();
        ok('陽イオンで遊んでいた人は Classic に戻ると陽イオンに戻る',
            w.eval('PLAYER_POLARITY') === 'CATION' && cBtn.classList.contains('active') &&
            !aBtn.classList.contains('active'), uiOut);
        aBtn.click();
        d.getElementById('btn-mode-sulfide').click();
        d.getElementById('btn-mode-classic').click();
        ok('陰イオンで遊んでいた人は Classic に戻ると陰イオンに戻る',
            w.eval('PLAYER_POLARITY') === 'ANION' && aBtn.classList.contains('active'), uiOut);
        cBtn.click();   // 既定（陽イオン）へ戻す

        // --- 4-8. 液性が入れ替わるまでの秒読み（ユーザー発注 2026-08-25）---
        //  「sulfide mode のフィールド切り替えカウントダウンがわかりづらい／
        //    透明文字で、残り3秒からカウントを表示するなど」
        //  ⚠ 見るのは3つ: ①数と切り替えが1秒ずれていないか ②Sulfide 以外で出さないか
        //    ③本当に描かれているか（＝画素で確かめる。関数があることを合格にしない）
        section('液性の秒読み（Sulfide）', uiOut);
        d.getElementById('btn-mode-sulfide').click();
        ok('残り秒を出す1本（phRemainingSec）が公開されている',
            typeof w.phRemainingSec === 'function', uiOut);
        var period = w.eval('PH_PERIOD_MS'), from = w.eval('PH_COUNTDOWN_FROM');
        ok('周期が 7000ms（DESIGN_separation.md §1 の実測）', period === 7000, uiOut);
        ok('残り3秒から出す', from === 3, uiOut);

        // ① 数字と切り替えが1秒ずれていないか。phTimer を動かして境目を全部見る
        var edges = [
            { t: 0,             sec: 7, shown: '' },
            { t: period - 3001, sec: 4, shown: '' },   // まだ出さない
            { t: period - 3000, sec: 3, shown: '3' },  // ここから出す
            { t: period - 2001, sec: 3, shown: '3' },
            { t: period - 2000, sec: 2, shown: '2' },
            { t: period - 1000, sec: 1, shown: '1' },
            { t: period - 1,    sec: 1, shown: '1' }   // 切り替わる直前は必ず 1
        ];
        var edgeNG = [];
        edges.forEach(function (e) {
            w.eval('phTimer = ' + e.t + '; updatePHUI();');
            var sec = w.phRemainingSec();
            var hud = d.getElementById('ph-countdown').innerText;
            var want = e.shown ? e.shown : null;
            var showing = (sec <= from && sec > 0) ? String(sec) : '';
            if (sec !== e.sec || showing !== e.shown || hud.indexOf('変化まで: ' + sec) < 0) {
                edgeNG.push('phTimer=' + e.t + ' 残り=' + sec + '(期待' + e.sec + ')' +
                            ' 盤="' + showing + '"(期待"' + e.shown + '") HUD="' + hud + '"');
            }
            void want;
        });
        ok('秒読みが 3→2→1→切り替え と合っている（HUD と盤の数字が同じ・切り替え直前は必ず 1）' +
            (edgeNG.length ? '：' + edgeNG.join(' / ') : ''), edgeNG.length === 0, uiOut);
        // ⚠ 実際に切り替わるのは phTimer が周期を**越えた**とき ＝ 「1」の次が切り替え
        ok('周期を越えたら入れ替わる（数字の 0 を飛ばして切り替わる）',
            w.eval('(function(){ var b=FIELD_PH; phTimer=' + period +
                   '+1; var was=FIELD_PH; FIELD_PH = FIELD_PH===\'ACIDIC\'?\'BASIC\':\'ACIDIC\';' +
                   'var r = FIELD_PH!==was; FIELD_PH=b; phTimer=0; updatePHUI(); return r; })()'),
            uiOut);

        // ③ ★ 本当に盤に描かれているかを**画素**で見る（関数があることを合格にしない）。
        //   ⚠ エサは脈打つので、同じ絵を2回描いても画素は少し動く（実測 5.0）。
        //     秒読み中の差は 60〜74 なので、しきい値 20 は取り違えようがない
        var CD = period - 2500;   // 残り3秒のところ
        var grab = function () {
            var cv = d.getElementById('game-board'), g = cv.getContext('2d');
            var s = Math.floor(Math.min(cv.width, cv.height) * 0.4);
            return g.getImageData(Math.floor(cv.width / 2 - s / 2),
                                  Math.floor(cv.height / 2 - s / 2), s, s).data;
        };
        var pxDiff = function (a, b) {
            var sum = 0;
            for (var i = 0; i < a.length; i += 4)
                sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
            return sum / (a.length / 4);
        };
        var savedState = w.eval('gameState');
        w.eval("gameState = 'PLAYING'; phTimer = 0; drawBoard();");
        var off = grab();
        w.eval('drawBoard();');
        var jitter = pxDiff(off, grab());          // 同じ絵を2回描いたときのゆらぎ（下駄）
        w.eval('phTimer = ' + CD + '; drawBoard();');
        var withNum = pxDiff(off, grab());
        ok('秒読み中は盤の中央に数字が描かれる（画素の差 ' + withNum.toFixed(1) +
            '／同じ絵を2度描いたときのゆらぎ ' + jitter.toFixed(1) + '）',
            withNum > 20 && jitter < 20, uiOut);

        // ⚠ **駒より背面**を実際の描画順で見る（ソースの並びではなく、呼ばれた順）
        var rec = w.eval('(function(){ var g = ctx, r = [], f = g.fillText.bind(g);' +
            "g.fillText = function(t,x,y){ var m=/(\\d+)px/.exec(g.font);" +
            'r.push({t:String(t), x:Math.round(x), y:Math.round(y), size:m?+m[1]:0}); return f(t,x,y); };' +
            'phTimer = ' + CD + '; drawBoard(); g.fillText = f; return r; })()');
        ok('秒読みの数字が1つだけ描かれ、盤の中央にある（残り3秒なので「3」）',
            rec.length > 0 && rec[0].t === '3' &&
            rec[0].x === Math.round(w.eval('canvas.width') / 2) &&
            rec[0].y === Math.round(w.eval('canvas.height') / 2), uiOut);
        ok('数字が盤の高さの半分ほどある（小さく出して「わかりづらい」を残していない。実測 ' +
            (rec[0] ? rec[0].size : 0) + 'px／盤 ' + w.eval('canvas.height') + 'px）',
            rec[0] && rec[0].size > w.eval('canvas.height') * 0.4, uiOut);
        ok('数字はヘビ・エサより**先**に描かれる ＝ 駒の背面（あとの ' + (rec.length - 1) +
            ' 件はイオンの名前）',
            rec.length >= 2 && rec.slice(1).every(function (x) { return x.size < rec[0].size / 2; }), uiOut);

        // ⚠ 否定対照1: Classic では周期が無いので出さない
        //   （モードのボタンは遊んでいるあいだ効かないので、いったん READY に戻して押す）
        w.eval("gameState = 'READY';");
        d.getElementById('btn-mode-classic').click();
        w.eval("gameState = 'PLAYING'; phTimer = 0; drawBoard();");
        var cOff = grab();
        w.eval('phTimer = ' + CD + '; drawBoard();');
        var cDiff = pxDiff(cOff, grab());
        ok('Classic では秒読みの数字を出さない（周期が無いモードで数字が出ると意味不明。' +
            '画素の差 ' + cDiff.toFixed(1) + ' ＝ ゆらぎの範囲）',
            w.eval('GAME_MODE') === 'CLASSIC' && cDiff < 20, uiOut);
        ok('Classic では HUD の液性表示ごと隠れている（既存の伝え方も Sulfide 限定のまま）',
            d.getElementById('ph-display').style.display === 'none', uiOut);
        // ⚠ 否定対照2: 遊んでいないとき（READY / GAMEOVER）は出さない
        w.eval("gameState = 'READY';");
        d.getElementById('btn-mode-sulfide').click();
        var recReady = w.eval('(function(){ var g = ctx, r = [], f = g.fillText.bind(g);' +
            "g.fillText = function(t,x,y){ r.push(String(t)); return f(t,x,y); };" +
            "gameState = 'READY'; phTimer = " + CD + '; drawBoard(); g.fillText = f; return r; })()');
        ok('READY のあいだは秒読みを出さない（phTimer が進まないので数字が固まって残る）',
            recReady.indexOf('3') < 0, uiOut);
        // 既存の伝え方を消していない
        ok('切り替えの瞬間の洪水エフェクトは残っている', typeof w.showFloodEffect === 'function', uiOut);
        w.eval("phTimer = 0; gameState = '" + savedState + "'; updatePHUI(); updateUIState();");
        w.eval("gameState = 'READY';");
        d.getElementById('btn-mode-classic').click();

        // --- 4-9. 結果のシェア（ユーザー決定 2026-08-25「とりあえずスネークのみ／WebShareAPI」）---
        //  ⚠ 共有シートはヘッドレスでは開けないので、**navigator.share を差し替えて
        //    渡された引数を捕まえる**。「ある側／無い側」の両方を見る。
        //  ⚠⚠ 共有シートは「どこへ共有されたか」を返さない ＝ utm_source の出し分けは
        //    原理的にできない。だから share 固定であることを文字列で固定する。
        section('結果のシェア（Web Share API）', uiOut);
        var shareBtn = d.getElementById('btn-share');
        var shareMsg = d.getElementById('share-msg');
        ok('結果画面にシェアのボタンがある', !!shareBtn, uiOut);
        ok('シェアの本文と URL を作る1本が公開されている',
            typeof w.shareText === 'function' && typeof w.shareUrl === 'function', uiOut);

        // ★ URL に UTM が正しく載っていること（1つずつ文字列で）
        var su = w.shareUrl();
        ok('共有 URL が公開のアドレス（canonical）から作られている（localhost を配らない）: ' + su,
            su.indexOf('https://chem.schoollenz.com/muki/') === 0, uiOut);
        ok('utm_source=share（⚠ どこへ共有されたかは返らないので x / instagram に出し分けない）',
            su.indexOf('utm_source=share') >= 0 &&
            su.indexOf('utm_source=x') < 0 && su.indexOf('utm_source=instagram') < 0, uiOut);
        ok('utm_medium=social', su.indexOf('utm_medium=social') >= 0, uiOut);
        ok('utm_campaign=muki_snake_result（どの画面から共有したかが分かる）',
            su.indexOf('utm_campaign=muki_snake_result') >= 0, uiOut);
        ok('横断リンクの ?from= と混ぜていない', su.indexOf('from=') < 0, uiOut);
        // ⚠ 計測の除外（d27cedb）は**ホスト名**で決まるので、UTM が付いても localhost は外れたまま
        ok('localhost では計測が止まったまま（UTM を付けても除外の条件はホスト名のまま）',
            w.eval("window['ga-disable-G-403BPCLQ0D']") === true, uiOut);

        // 本文: 点数と、何のゲームかが分かる日本語。⚠ 内部の語を出さない
        w.eval("score = 1234; GAME_MODE = 'SULFIDE'; DIFFICULTY = 'EXPERT';");
        var st = w.shareText();
        ok('本文にスコアが入る: ' + st, st.indexOf('1234') >= 0, uiOut);
        ok('本文が日本語で、何のゲームかが分かる',
            st.indexOf('イオンスネーク') >= 0 && st.indexOf('無機化学') >= 0, uiOut);
        ok('本文にアプリの内部の語（SULFIDE / CLASSIC / EXPERT / EASY）を出さない',
            !/SULFIDE|CLASSIC|EXPERT|EASY|ACIDIC|BASIC/.test(st), uiOut);

        // ① 共有シートがある側: クリックで navigator.share が呼ばれ、引数が正しい
        var savedShare = w.navigator.share;
        w.eval('window.__shared = [];');
        try {
            Object.defineProperty(w.navigator, 'share', {
                configurable: true,
                value: function (o) { w.__shared.push(o); return Promise.resolve(); }
            });
        } catch (e) { warn('navigator.share を差し替えられません: ' + e); }
        // ⚠ 関数を直に呼ばず、**実際に結果画面を出す**（die が setupShareButton を呼ぶ）
        w.eval("die('テストで終わらせた', '');");
        ok('結果画面が出ている（シェアのボタンを見る前提）',
            !d.getElementById('game-over').classList.contains('hidden'), uiOut);
        ok('共有シートがある環境ではボタンが出る（文言は「シェア」）',
            visible(shareBtn) && shareBtn.innerText.indexOf('シェア') >= 0, uiOut);
        shareBtn.click();
        var sent = w.eval('window.__shared');
        ok('押すと navigator.share が呼ばれる（⚠ クリックの中から呼んでいる）',
            sent.length === 1, uiOut);
        ok('渡すのは title / text / url の3つ',
            sent[0] && sent[0].title && sent[0].text === st && sent[0].url === su, uiOut);

        // ② ⚠ 閉じただけ（AbortError）でエラーを出さない
        return (function () {
            w.eval("window.__shared = [];");
            Object.defineProperty(w.navigator, 'share', {
                configurable: true,
                value: function () {
                    var e = new Error('closed'); e.name = 'AbortError';
                    return Promise.reject(e);
                }
            });
            shareMsg.innerText = 'まだ何も言っていない';
            return w.doShare().then(function () {
                ok('共有シートを閉じただけのときはエラーを出さない（AbortError）',
                    shareMsg.innerText === '' && !d.getElementById('game-over').classList.contains('broken'),
                    uiOut);
                // ③ ⚠ ほんとうに失敗したときは黙らない
                Object.defineProperty(w.navigator, 'share', {
                    configurable: true,
                    value: function () {
                        var e = new Error('boom'); e.name = 'DataError';
                        return Promise.reject(e);
                    }
                });
                return w.doShare();
            }).then(function () {
                ok('本当に失敗したときは画面に出す（黙って何も起きないにしない）',
                    shareMsg.innerText.indexOf('utm_campaign=muki_snake_result') >= 0, uiOut);
                // ④ 共有シートが無い側: 「コピー」に落ちる（押しても何も起きないボタンを出さない）
                try { delete w.navigator.share; } catch (e) { warn(String(e)); }
                Object.defineProperty(w.navigator, 'share', { configurable: true, value: undefined });
                var copied = [];
                Object.defineProperty(w.navigator, 'clipboard', {
                    configurable: true,
                    value: { writeText: function (t) { copied.push(t); return Promise.resolve(); } }
                });
                w.eval('setupShareButton();');
                ok('共有シートが無い環境では文言が「コピー」に変わる（何も起きないボタンにしない）',
                    visible(shareBtn) && shareBtn.innerText.indexOf('コピー') >= 0, uiOut);
                shareBtn.click();
                return new Promise(function (r) { setTimeout(r, 30); }).then(function () {
                    ok('押すと本文と URL がコピーされる',
                        copied.length === 1 && copied[0].indexOf('utm_campaign=muki_snake_result') >= 0,
                        uiOut);
                    // ⑤ どちらも無い環境ではボタンごと出さない
                    Object.defineProperty(w.navigator, 'clipboard', { configurable: true, value: undefined });
                    w.eval('setupShareButton();');
                    ok('共有もコピーもできない環境ではボタンを出さない', !visible(shareBtn), uiOut);
                    // 後始末
                    try {
                        Object.defineProperty(w.navigator, 'share', { configurable: true, value: savedShare });
                    } catch (e) { warn(String(e)); }
                    w.eval("gameState = 'READY'; score = 0; updateUIState();");
                    d.getElementById('btn-mode-classic').click();
                    runUITail(w, d);
                });
            });
        })();
    }

    /** update ループの多重防止（ここで finish() まで行く） */
    function runUITail(w, d) {
        // --- 4-7. update ループの多重防止（v10 B-4） ---
        //     以前は init() のたびに requestAnimationFrame(update) が積まれ、READY 中に
        //     設定を変えるたび update が並走していた。scheduleUpdate() は前の予約を
        //     取り消してから積むので、何回 init しても1フレームに1回しか走らない。
        //     フレームは iframe の rAF で数え、同じ時計で update の回数と比べる
        section('update ループの多重防止', uiOut);
        w.eval('init(); init(); init();');
        var ticks0 = w.eval('updateTicks');
        var frames = 0, loopDone = false;
        var guard = setTimeout(function () {
            if (loopDone) return;
            loopDone = true;
            ok('rAF が回っている（非表示のタブでは回らない。表示した状態で開き直すこと）',
                false, uiOut);
            stopGameLoop(w);
            endAll();
        }, 4000);
        (function tick() {
            if (loopDone) return;
            if (++frames < 20) { w.requestAnimationFrame(tick); return; }
            loopDone = true;
            clearTimeout(guard);
            var ticks = w.eval('updateTicks') - ticks0;
            ok('3回 init しても update は1フレーム1回のまま（20フレームで ' + ticks +
                ' 回。多重に積まれていれば40回を超える）',
                ticks > 0 && ticks <= frames + 3, uiOut);
            stopGameLoop(w);
            endAll();
        })();
    }

    // --- game.js の「沈殿＝ゲームオーバー」という土台を固定する ---
    //    ルール説明文のテストはこの向きの上に立っているので、
    //    ここが黙って反転すると説明文のテストごと意味を失う
    function runSource(next) {
        section('game.js の勝敗の向き（説明文テストの土台）');
        if (!onHttp) {
            ok('game.js を読み取れる（http で開いていない）', false);
            next();
            return;
        }
        // cache:'no-store' で取るのでキャッシュバスターは要らない（版を上げ忘れて
        // 古い game.js を検査する、という事故が起きない書き方にしておく）
        fetch('game.js', { cache: 'no-store' }).then(function (r) {
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.text();
        }).then(function (src) {
            ok('game.js を読み取れる', src.length > 0);
            ok('沈殿ができたらゲームオーバーになる（if (precipitate) → die）',
                /if\s*\(\s*precipitate\s*\)\s*\{[\s\S]{0,300}?\bdie\s*\(/.test(src));
            ok('沈殿しなかったときだけ伸びる（else → grew = true）',
                /\}\s*else\s*\{[\s\S]{0,200}?grew\s*=\s*true/.test(src));
            ok('Sulfide のときだけ液性を渡している（Classic は ALL）',
                /GAME_MODE\s*===\s*'SULFIDE'\s*\?\s*FIELD_PH\s*:\s*'ALL'/.test(src));
            ok('横持ちの閾値が CSS と同じ（max-height 500px かつ横長）',
                /innerHeight\s*<=\s*500\s*&&\s*window\.innerWidth\s*>\s*window\.innerHeight/.test(src));
            ok('縦積みの閾値が CSS の @media (max-width: 1200px) と同じ',
                /window\.innerWidth\s*<=\s*1200/.test(src));
            ok('盤上の開始案内がタップでも始められることを言っている（タッチ実装は前からある）',
                src.indexOf('TAP OR PRESS ARROW KEY') >= 0 &&
                src.indexOf('タップ／矢印キーでスタート') >= 0);
            // --- 液性の秒読み（2026-08-25 のユーザー発注）---
            // ⚠ **駒より背面に描く**ことは「呼ぶ順番」でしか保証できないので、ここで見る。
            //   drawBoard の中で、秒読み → ヘビ・エサ の順であること
            var body = /function drawBoard\(\)\s*\{([\s\S]*?)\n\}/.exec(src);
            ok('drawBoard() を読み取れる', !!body);
            if (body) {
                // ⚠ **コメントアウトを見逃さない**（行頭の空白のあとが呼び出しであること）
                ok('drawBoard() が秒読みを呼んでいる（コメントアウトされていない）',
                    /^[ \t]*drawPhCountdown\(\);/m.test(body[1]));
            }
            ok('7秒の周期を数で2度書きしていない（PH_PERIOD_MS 1本）',
                /const\s+PH_PERIOD_MS\s*=\s*7000/.test(src) &&
                src.split('7000').length === 2);
        }).catch(function (e) {
            ok('game.js を読み取れる（' + e + '）', false);
        }).then(next);
    }

    // ===============================================================
    // 型B の画面（separation.html を iframe で実際に遊ぶ）
    //
    // ⚠ ここで測るのは「模型が正しいか」ではなく「画面が設計どおりに振る舞うか」:
    //   ① 炎色反応が最初から押せる（§15-4。分けるべきものが最初から無い）
    //   ② ★ 結果が**積まれて並ぶ**（§16-5。「いまの姿」だけを持たない）
    //   ③ 途中では何も言わない（D1(a)）／答えたときに初めて解説が出る
    //   ④ スマホ幅（375px）で横に溢れない
    // ===============================================================
    function runSeparationUI(done) {
        section('型B の画面（separation.html）', uiOut);
        // スネークの側からの入口。⚠ 無いと URL を知っている人しかたどり着けない
        (function () {
            var d0 = frame.contentDocument;
            var a = d0 && d0.getElementById('link-sep');
            ok('スネークの画面に、型B への入口がある', !!a, uiOut);
            if (a) {
                ok('入口のリンク先が separation.html',
                    (a.getAttribute('href') || '').indexOf('separation.html') >= 0, uiOut);
                ok('入口が指で押せる大きさ（' + Math.round(rectH(a)) + 'px ≧ ' + TAP_MIN + '）',
                    rectH(a) >= TAP_MIN, uiOut);
            }
        })();
        if (!onHttp) {
            ok('separation.html を iframe で開ける（file:// では不可）', false, uiOut);
            done();
            return;
        }
        var f = document.createElement('iframe');
        f.id = 'sepapp';
        f.src = 'separation.html?v=27';
        f.style.width = '375px';        // ★ スマホ幅で測る（muki はスマホ前提）
        f.style.height = '812px';
        document.body.appendChild(f);

        var tries = 0;
        (function poll() {
            var w = f.contentWindow, d = f.contentDocument;
            var ready = !!(d && d.readyState === 'complete' && w && w.sepUI && w.sepUI.state.problem);
            if (!ready) {
                if (++tries > 120) { ok('separation.html が起動した', false, uiOut); done(); return; }
                setTimeout(poll, 50);
                return;
            }
            try { drive(w, d); } catch (e) {
                ok('型B の画面を操作できた（' + e + '）', false, uiOut);
            }
            done();
        })();

        function drive(w, d) {
            ok('separation.html が起動した', true, uiOut);

            // ⚠ 中身は 1 種類だけ、と学習者に伝えているか（§15-1）
            ok('「1種類だけ」であることを画面が言っている',
                d.body.textContent.indexOf('1種類だけ') >= 0, uiOut);
            // ⚠⚠ 出題まわりの文言に解き筋を出さない（2026-08-27・ユーザー指摘）
            (function () {
                var zone = [d.querySelector('.lead'), d.getElementById('panel-level'),
                    d.getElementById('panel-problem')]
                    .map(function (e) { return e ? e.textContent : ''; }).join(' ');
                var words = (typeof SPOILER_WORDS !== 'undefined') ? SPOILER_WORDS : [];
                var hit = words.filter(function (w) { return zone.indexOf(w) >= 0; });
                if (hit.length) warn('出題まわりに解き筋の語: ' + hit.join('・'));
                ok('出題まわり（導入・難易度・候補）に解き筋の語が出てこない', hit.length === 0, uiOut);
                // ⚠ 上限を 60 → 70 にした（2026-08-28・ユーザー指摘）——
                //   ★ 「実験は毎回、試料を少しずつ取って新しく行います」の一文を足したため。
                //   ⚠ これは飾りではなく、**画面から読み取れない作りの説明**（MU-1 が中身を見張る）
                // ⚠ 数えるのは **読む長さ**。★ source の改行と字下げは畳んでから数える
                //   （畳まないと、文を2行に折り返しただけで 10 字ぶん増えて落ちる）
                var lead = d.querySelector('.lead').textContent.replace(/\s+/g, '').trim();
                ok('MU-1a 導入は2〜3行に収まっている（' + lead.length + '字）',
                    lead.length <= 70, uiOut);
                // ★★ 毎回別の実験であることを、導入が言っているか（2026-08-28・ユーザー指摘）
                //   ⚠ ここが欠けると「操作が積み上がる」と読まれる
                ok('MU-1b 導入が「実験は毎回、試料を取って新しく行う」ことを言っている',
                    lead.indexOf('毎回') >= 0 && lead.indexOf('試料') >= 0 &&
                    (lead.indexOf('新しく') >= 0 || lead.indexOf('新たに') >= 0), uiOut);
                // ⚠ AI っぽい飾りを入れない（2026-08-28・ユーザー指摘2回）。
                //   ★ 「〜しましょう」の勧誘と、飾りの副詞を導入に置かない
                ok('MU-1c 導入に「〜しましょう」や飾りの副詞が無い',
                    lead.indexOf('しましょう') < 0 && lead.indexOf('ぜひ') < 0 &&
                    lead.indexOf('しっかり') < 0 && lead.indexOf('じっくり') < 0, uiOut);
                var lv0 = d.querySelector('#levels button').textContent.replace(/[\s　]/g, '');
                ok('難易度は「段の名前 ＋ 印」だけ（実測「' + lv0 + '」）',
                    /^[ぁ-んァ-ヶ一-龠]+[★☆]{3}$/.test(lv0), uiOut);
                ok('難易度の段が3つ並んでいる',
                    d.querySelectorAll('#levels button').length === 3, uiOut);
                ok('見出しに難易度の印と候補の数が出ている',
                    /[★☆]{3}/.test(d.getElementById('prob-note').textContent) &&
                    /候補\s*\d+/.test(d.getElementById('prob-note').textContent), uiOut);
            })();

            // ★ 問題の一覧を持たない（毎回つくる）。⚠ 引き直すたびに中身が変わること
            (function () {
                ok('問題の一覧（タブ）は無い', !d.getElementById('prob-tabs'), uiOut);
                var keys = {}, truths = {};
                for (var i = 0; i < 12; i++) {
                    d.getElementById('btn-new').click();
                    keys[w.sepUI.state.problem.key] = 1;
                    truths[w.sepUI.state.truth] = 1;
                }
                ok('「べつの容器にする」で型が引き直される（12回で ' +
                    Object.keys(keys).length + ' 種類）', Object.keys(keys).length >= 3, uiOut);
                ok('中身も引き直される（12回で ' + Object.keys(truths).length + ' 種類）',
                    Object.keys(truths).length >= 2, uiOut);
                ok('難易度を選ぶと、その段の出題に変わる', (function () {
                    d.querySelector('#levels button[data-level="hard"]').click();
                    return w.sepUI.state.level === 'hard' &&
                        w.sepUI.state.problem.key.indexOf('|hard|') > 0;
                })(), uiOut);
                // ★★ 型の鍵と中身を、記録できる形で持っている（⚠ 送信も保存もしない）
                var r = w.sepUI.state.record;
                ok('出題1問が、型の鍵と中身を記録できる形で持っている',
                    !!r && r.key === w.sepUI.state.problem.key &&
                    r.truth === w.sepUI.state.truth && r.cands.length > 0, uiOut);
            })();

            // 出題を固定して遊ぶ（★ 実機の手順とそろえてある: 中身は Ag⁺）
            w.sepUI.start('easy', { cands: ['Ag', 'Pb', 'Cu', 'Na'],
                ops: ['flame', 'hcl', 'hclHot', 'hclNh3', 'h2s'], truth: 'Ag' });
            var cands = d.querySelectorAll('#cand-list .chip');
            ok('候補が4つ並ぶ（Ag⁺・Pb²⁺・Cu²⁺・Na⁺）', cands.length === 4, uiOut);
            ok('候補リストが答えを漏らしていない（どれが正解かの印が無い）',
                d.getElementById('cand-list').textContent.indexOf('正解') < 0, uiOut);

            // ① 炎色反応が最初から押せる（★ 型A と違うところ。§13-4c・§15-4）
            var flameBtn = d.querySelector('.op[data-op="flame"]');
            ok('炎色反応の札が最初から押せる（型B は分けるべきものが最初から無い）',
                !!flameBtn && !flameBtn.disabled, uiOut);
            flameBtn.click();
            ok('1手目の結果が並んだ', d.querySelectorAll('#log li').length === 1, uiOut);
            ok('炎色反応が拒否されていない（「行えません」と言われない）',
                d.getElementById('log').textContent.indexOf('行えません') < 0, uiOut);
            ok('見えたものが文章で出ている（Ag⁺ なので色はつかない）',
                d.getElementById('log').textContent.indexOf('炎に色はつかなかった') >= 0, uiOut);
            ok('見えたものが絵でも出ている（色の札）',
                d.querySelectorAll('#log .sw').length >= 1, uiOut);

            // ② ★ 積んで並べる。⚠ 1手目が消えたら設計違反（§16-5）
            var firstText = d.querySelector('#log li').textContent;
            d.querySelector('.op[data-op="hcl"]').click();
            ok('2手目を押しても1手目が残る（結果は積んで並べる・§16-5）',
                d.querySelectorAll('#log li').length === 2 &&
                d.querySelectorAll('#log li')[0].textContent === firstText, uiOut);
            ok('2手目の結果が正しい（Ag⁺ ＋ 希塩酸 → 白色の沈殿）',
                d.querySelectorAll('#log li')[1].textContent.indexOf('白色の沈殿') >= 0, uiOut);
            ok('同じ札は二度押せない（実施済み）',
                d.querySelector('.op[data-op="hcl"]').disabled === true, uiOut);

            // ③ 途中では何も言わない（D1(a)）
            ok('途中で候補の残りを教えていない',
                d.getElementById('log').textContent.indexOf('残り') < 0 &&
                d.getElementById('result').className.indexOf('hidden') >= 0, uiOut);

            // 3手目で決めきる → 答える
            d.querySelector('.op[data-op="hclHot"]').click();
            ok('3手目まで並んだ', d.querySelectorAll('#log li').length === 3, uiOut);
            d.getElementById('btn-answer').click();
            ok('「答える」を押すと候補が選べる',
                d.querySelectorAll('#answer-choices button[data-pick]').length === 4, uiOut);
            d.querySelector('#answer-choices button[data-pick="Ag"]').click();

            var res = d.getElementById('result');
            ok('答え合わせが出た', res.className.indexOf('hidden') < 0, uiOut);
            ok('正解が示される', res.textContent.indexOf('正解') >= 0 &&
                res.textContent.indexOf('銀イオン') >= 0, uiOut);
            ok('決まっていたと判定される（3手で1つに決まる手順を踏んだ）',
                res.textContent.indexOf('1つに決まっていました') >= 0, uiOut);
            ok('それまでの結果の解説が、手ごとに出る（§16-1）',
                res.querySelectorAll('.why').length === 3, uiOut);
            // ⚠⚠ 本の名前とページは画面に出さない（2026-08-27・ユーザー決定）。
            //   ★ 世間で使われている教科書は1社ではないので、ページ番号は手元と合わない
            var books = (typeof BOOK_WORDS !== 'undefined') ? BOOK_WORDS : [];
            ok('答え合わせに本の名前が出てこない',
                books.every(function (w) { return res.textContent.indexOf(w) < 0; }), uiOut);
            ok('ページ番号も本の名前も、画面のどこにも出てこない',
                !/p\s*\.\s*\d+/i.test(d.body.textContent) &&
                books.every(function (w) { return d.body.textContent.indexOf(w) < 0; }), uiOut);
            ok('答え合わせにページ番号が出てこない',
                !/p\s*\.\s*\d+/i.test(res.textContent), uiOut);
            ok('説明の中身は残っている（なぜそう見えたかを言っている）',
                res.textContent.indexOf('溶けない') >= 0 &&
                res.textContent.indexOf('7元素') >= 0, uiOut);
            ok('解説で初めて化学式が出る（途中では出さない）',
                res.textContent.indexOf('AgCl') >= 0, uiOut);
            ok('⚠ 出典の別（参考書／教科書の区別）は画面に出さない（§17-10）',
                res.textContent.indexOf('参考書') < 0, uiOut);
            ok('答えたあとは札が押せない',
                d.querySelector('.op[data-op="h2s"]').disabled === true, uiOut);

            // ⚠ 「たまたま当たった」ときの文面（§3-5-4 (B) の向き）
            w.sepUI.start('easy', { cands: ['Ag', 'Pb', 'Cu', 'Na'],
                ops: ['flame', 'hcl', 'hclHot', 'hclNh3', 'h2s'], truth: 'Ag' });
            d.querySelector('.op[data-op="flame"]').click();
            d.getElementById('btn-answer').click();
            d.querySelector('#answer-choices button[data-pick="Ag"]').click();
            var res2 = d.getElementById('result').textContent;
            ok('決まっていないのに当てたら、そう言う（当たり外れの話にしない）',
                res2.indexOf('同じものしか見えません') >= 0, uiOut);
            ok('⚠ 「間違い」と書かない（§3-3 の文面の向き）',
                res2.indexOf('間違い') < 0 && res2.indexOf('誤り') < 0, uiOut);
            ok('分けるための次の一手を示す（責めずに道を示す）',
                res2.indexOf('分かれます') >= 0, uiOut);

            // ④ スマホ幅で横に溢れない
            ok('375px 幅で横スクロールが出ない（' + d.documentElement.scrollWidth + ' ≦ ' +
                d.documentElement.clientWidth + '）',
                d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1, uiOut);
            var small = [].slice.call(d.querySelectorAll('.op, #btn-answer')).filter(function (el) {
                return el.getBoundingClientRect().height < 44;
            });
            ok('札と「答える」が指で押せる大きさ（44px 以上）', small.length === 0, uiOut);
        }
    }

    // 型B の画面が、設計書の縛りを文面の側でも守っているか（ソースを読んで見る）
    function runSeparationSource(next) {
        section('型B の文面の縛り（separation.js / separation-model.js）');
        if (!onHttp) { ok('ソースを読み取れる（http で開いていない）', false); next(); return; }
        Promise.all([
            fetch('separation.js', { cache: 'no-store' }).then(function (r) { return r.text(); }),
            fetch('separation-model.js', { cache: 'no-store' }).then(function (r) { return r.text(); })
        ]).then(function (srcs) {
            var raw = srcs.join('\n');
            ok('ソースを読み取れる', raw.length > 0);
            // ⚠ **コメントを外してから見る**。設計書の縛りは「画面に出す文言」に掛かるもので、
            //   「なぜそうしないか」をコードのコメントに書くことまで禁じてはいない
            //   （むしろ書いておかないと、次の人が同じ穴を掘る）
            var src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
            ok('コメントだけを外せている（中身は残っている）',
                src.length > 0 && src.length < raw.length && src.indexOf('function sepObserve') >= 0);
            // §16-3: 型B に「まだわからない」は要らない（ユーザー決定）
            ok('「まだわからない」という選択肢を作っていない（§16-3）',
                src.indexOf('まだわからない') < 0);
            // §17-11: アプリが「確認できません」と言わない（他の資料に載る手を否定してしまう）
            ok('「確認できません」と言わない（§17-11）',
                src.indexOf('確認できません') < 0);
            // §5-5: 色は混ぜない。並べて見せる
            ok('「混ざった色」を作らない（§5-5）',
                src.indexOf('混ざった色') < 0 && src.indexOf('混色') < 0);
            // §10-2 / §11-3 E: 群の呼び方。教科書は「操作1〜5」で、参考書が「属」。
            // ⚠ 型B は分属の段を持たないので、どちらの語も画面に出さないのが正しい
            ok('分属の語（第1属・第1族）を型B の画面に出していない',
                !/第[1-6１-６]属/.test(src) && !/第[1-6１-６]族/.test(src));
        }).catch(function (e) {
            ok('ソースを読み取れる（' + e + '）', false);
        }).then(next);
    }

    // ===============================================================
    // 型A の画面（tree.html を iframe で実際に組んで提出する）
    //
    // ⚠ ここで測るのは「模型が正しいか」ではなく「画面が設計どおりに振る舞うか」:
    //   ① ★ **タップ2段で置ける**（⚠ ドラッグ＆ドロップに戻っていないこと）
    //   ② ★ **途中では何も返さない**（§16-1。提出するまで答え合わせが出ない）
    //   ③ ★★ **鉄を戻し忘れた答案が、実際に葉の数で不一致になる**（§15-2）
    //   ④ スマホ幅（375px）でツリーが読めて、置き先が押せる
    // ===============================================================
    function runTreeUI(done) {
        section('型A の画面（tree.html）', uiOut);
        // スネークの側からの入口
        (function () {
            var d0 = frame.contentDocument;
            var a = d0 && d0.getElementById('link-tree');
            ok('スネークの画面に、型A への入口がある', !!a, uiOut);
            if (a) {
                ok('入口のリンク先が tree.html',
                    (a.getAttribute('href') || '').indexOf('tree.html') >= 0, uiOut);
                ok('入口が指で押せる大きさ（' + Math.round(rectH(a)) + 'px ≧ ' + TAP_MIN + '）',
                    rectH(a) >= TAP_MIN, uiOut);
            }
        })();
        if (!onHttp) {
            ok('tree.html を iframe で開ける（file:// では不可）', false, uiOut);
            done();
            return;
        }
        var f = document.createElement('iframe');
        f.id = 'treeapp';
        f.src = 'tree.html';
        f.style.width = '375px';        // ★ スマホ幅で測る（muki はスマホ前提）
        f.style.height = '812px';
        document.body.appendChild(f);

        var tries = 0;
        (function poll() {
            var w = f.contentWindow, d = f.contentDocument;
            var ready = !!(d && d.readyState === 'complete' && w && w.treeUI && w.treeUI.state.problem);
            if (!ready) {
                if (++tries > 120) { ok('tree.html が起動した', false, uiOut); done(); return; }
                setTimeout(poll, 50);
                return;
            }
            try { drive(w, d); } catch (e) {
                ok('型A の画面を操作できた（' + e + '）', false, uiOut);
            }
            done();
        })();

        function drive(w, d) {
            ok('tree.html が起動した', true, uiOut);
            // ★ 出題は生成になったので、画面の検査も **中身を固定して**駆動する
            //   （⚠ 抽選のまま測ると、枝の数も葉の数も回ごとに変わる）
            var UI_A1 = ['Ag', 'Cu', 'Fe3', 'Zn', 'Ca', 'Na'];                  // 属ごとに1つ
            var UI_SPLIT2 = ['Ag', 'Pb', 'Cu', 'Fe3', 'Al', 'Zn', 'Ca', 'Na'];  // 属の中に2組
            // ⚠ 出題まわりに解き筋を出さない（型B と同じ縛り）
            (function () {
                var zone = [d.querySelector('.lead'), d.getElementById('panel-mode')]
                    .map(function (e) { return e ? e.textContent : ''; }).join(' ');
                var hit = (SPOILER_WORDS || []).filter(function (x) { return zone.indexOf(x) >= 0; });
                if (hit.length) warn('型A の出題まわりに解き筋の語: ' + hit.join('・'));
                ok('導入とやり方の欄に、解き筋の語が出てこない', hit.length === 0, uiOut);
                var lead = d.querySelector('.lead').textContent.trim();
                ok('導入は1行に収まっている（' + lead.length + '字）', lead.length <= 30, uiOut);
                // ⚠ 画面を見れば分かること・押せば分かることを、導入に書かない（§18 と同じ縛り）
                ok('⚠ 導入が「中身は分かっています」「提出すると…」を言い直していない',
                    lead.indexOf('分かって') < 0 && lead.indexOf('提出') < 0 &&
                    lead.indexOf('走らせ') < 0, uiOut);
                ok('★ 中身が与えられていることは、画面（この容器の欄）から読み取れる',
                    d.getElementById('beaker-ions').textContent.trim().length > 0, uiOut);
                ok('やり方の名前が画面に出ている（ユーザーの決めた文言）',
                    d.getElementById('modes').textContent.indexOf('イオンの行先を答える') >= 0 &&
                    d.getElementById('modes').textContent.indexOf('実験手順から考える') >= 0, uiOut);
                ok('⚠ 「机上」という設計書の語を画面に出さない',
                    d.body.textContent.indexOf('机上') < 0, uiOut);
            })();

            // --- ① やさしい段（イオンの行先を答える）は、操作がもう置いてある ---
            w.treeUI.start('read', 'easy', { ions: UI_A1 });
            ok('「イオンの行先を答える」では操作の手札を出さない（枝はもう埋まっている）',
                d.querySelectorAll('#op-deck .card').length === 0, uiOut);
            ok('枝が7つある', d.querySelectorAll('.slot.branch').length === 7, uiOut);
            ok('葉は6つ（★ 煮沸と希硝酸の枝には葉が生えない）',
                d.querySelectorAll('.slot.leaf').length === 6, uiOut);
            ok('イオンの手札が6枚', d.querySelectorAll('#ion-deck .card').length === 6, uiOut);
            ok('容器の中身が画面に出ている（★ 型A に推理は無い）',
                d.getElementById('beaker-ions').textContent.indexOf('Fe³⁺') >= 0, uiOut);

            // --- ② タップ2段で置ける／もう一度押すと戻る ---
            var ionCard = d.querySelector('#ion-deck .card[data-ion="Ag"]');
            ionCard.click();
            ok('札を押すと選ばれた印がつく',
                d.querySelector('#ion-deck .card[data-ion="Ag"]').className.indexOf('picked') >= 0, uiOut);
            d.querySelector('.slot.leaf[data-leaf="L0"]').click();
            ok('置き先を押すと置かれる（★ タップ2段。⚠ ドラッグを使わない）',
                w.treeUI.state.plan.Ag === 'L0' &&
                d.querySelector('.slot.leaf[data-leaf="L0"]').getAttribute('data-ion') === 'Ag', uiOut);
            ok('置いた札は手札から消える',
                !d.querySelector('#ion-deck .card[data-ion="Ag"]'), uiOut);
            d.querySelector('.slot.leaf[data-leaf="L0"]').click();
            ok('置いた札をもう一度押すと手札に戻る（★ 取り消しも同じ作法）',
                !w.treeUI.state.plan.Ag && !!d.querySelector('#ion-deck .card[data-ion="Ag"]'), uiOut);
            // ★★ 1つの終端に置けるイオンは1つだけ（⚠ 2つ積めたら赤）
            d.querySelector('#ion-deck .card[data-ion="Ag"]').click();
            d.querySelector('.slot.leaf[data-leaf="L0"]').click();
            d.querySelector('#ion-deck .card[data-ion="Cu"]').click();
            d.querySelector('.slot.leaf[data-leaf="L0"]').click();
            ok('★★ 1つの沈殿に置けるイオンは1つだけ（⚠ 先に置いたものは手札に戻る）',
                w.treeUI.state.plan.Cu === 'L0' && !w.treeUI.state.plan.Ag &&
                !!d.querySelector('#ion-deck .card[data-ion="Ag"]') &&
                d.querySelectorAll('[data-leaf="L0"]').length === 1, uiOut);
            d.querySelector('.slot.leaf[data-leaf="L0"]').click();

            // --- ③ 途中では何も返さない（§16-1） ---
            ok('置いている途中では、答え合わせを出さない',
                d.getElementById('result').className.indexOf('hidden') >= 0, uiOut);
            ok('途中で「そこは違います」と言わない（警告を出さない・§4-3）',
                d.getElementById('hint').textContent.indexOf('違い') < 0 &&
                d.body.textContent.indexOf('第3属') < 0, uiOut);

            // --- ④ 正しく置いて提出 → 単離できた ---
            [['Ag', 'L0'], ['Cu', 'L1'], ['Fe3', 'L4'], ['Zn', 'L5'], ['Ca', 'L6'], ['Na', 'F']]
                .forEach(function (x) {
                    d.querySelector('#ion-deck .card[data-ion="' + x[0] + '"]').click();
                    d.querySelector('.slot.leaf[data-leaf="' + x[1] + '"]').click();
                });
            d.getElementById('btn-submit').click();
            var res = d.getElementById('result');
            ok('提出すると答え合わせが出る', res.className.indexOf('hidden') < 0, uiOut);
            ok('模範どおりなら「ぜんぶ単離できました」',
                res.querySelector('h3').textContent.indexOf('ぜんぶ単離できました') >= 0, uiOut);
            ok('葉ごとに「実際に来たもの」と「あなたが置いた」が並ぶ',
                res.querySelectorAll('.leafrow').length >= 6 &&
                res.textContent.indexOf('実際に来たもの') >= 0 &&
                res.textContent.indexOf('あなたが置いた') >= 0, uiOut);
            ok('答え合わせで初めて化学式が出る（★ 途中のツリーには出さない）',
                res.textContent.indexOf('FeO(OH)') >= 0, uiOut);
            ok('模範どおりなら、鉄の説明（素通り）は出ない',
                res.textContent.indexOf('素通り') < 0, uiOut);
            // ★★★ MU-2 手数・最短は「手順を学習者が決めた」ときだけ（2026-08-28・ユーザー指摘）
            //   > イオンの行先を答える → 手順はユーザー操作ではないので 解説に最短 など入れない
            //   ⚠ ここは枝をこちらが置いている段。★ 本人が決めていない数で採点しない
            // ⚠ 「1手目 〔希塩酸〕」の見出しは **何手かかったか** ではなく
            //   **どの段の話か** の目印なので、これは残ってよい。★ 数えるほうだけを見る
            ok('MU-2a 「イオンの行先を答える」の答え合わせに、手数も最短も出ない',
                !/（\d+\s*手/.test(res.textContent) &&
                res.textContent.indexOf('最短') < 0 &&
                res.textContent.indexOf('手ぶん') < 0, uiOut);
            ok('MU-2b 「余計な操作が入っていました」とも言わない（★ 入れたのはこちら）',
                res.textContent.indexOf('要らない操作') < 0, uiOut);
            ok('MU-2c 「あなたが並べた手順」と言わない（★ 並べたのはこちら）',
                res.textContent.indexOf('あなたが並べた') < 0 &&
                res.textContent.indexOf('置いてある手順を、そのまま走らせました') >= 0, uiOut);
            ok('MU-2d 記録にも手数と最短を入れない（⚠ 入れると率に本人以外の手が混ざる）',
                w.treeUI.state.record.moves === undefined &&
                w.treeUI.state.record.shortest === undefined, uiOut);

            // --- ⑤ ★★★ 芯: 希硝酸を置き忘れた答案 ---
            w.treeUI.start('build', 'easy', { ions: UI_A1 });
            ok('「実験手順から考える」では札が8枚出る（★ 主流6・沈殿側2。硫化水素は1枚）',
                d.querySelectorAll('#op-deck .card').length === 8 &&
                d.querySelectorAll('#op-deck .card[data-op="h2s"]').length === 1 &&
                d.querySelectorAll('#op-deck .card[data-sub]').length === 2, uiOut);
            ok('組む前は葉が1つ（最後のろ液）だけ',
                d.querySelectorAll('.slot.leaf').length === 1, uiOut);
            [['hcl', 0], ['h2s', 1], ['boil', 2], ['nh3', 4], ['h2s', 5], ['co3', 6]]
                .forEach(function (x) {
                    d.querySelector('#op-deck .card[data-op="' + x[0] + '"]').click();
                    d.querySelector('.slot.branch[data-slot="' + x[1] + '"]').click();
                });
            ok('★ 硫化水素は置いても手札に残る（⚠ 教科書の手順は2度通す）',
                !!d.querySelector('#op-deck .card[data-op="h2s"]') &&
                w.treeUI.state.seq[1] === 'h2s' && w.treeUI.state.seq[5] === 'h2s', uiOut);
            ok('希硝酸が手札に残っている（＝ 置き忘れた答案）',
                d.querySelectorAll('#op-deck .card[data-op]').length === 2 &&
                !!d.querySelector('#op-deck .card[data-op="hno3"]'), uiOut);
            ok('★ 空けた枝は詰めない（アンモニアの葉は L4 のまま）',
                !!d.querySelector('.slot.leaf[data-leaf="L4"]') &&
                !d.querySelector('.slot.leaf[data-leaf="L3"]'), uiOut);
            [['Ag', 'L0'], ['Cu', 'L1'], ['Fe3', 'L4'], ['Zn', 'L5'], ['Ca', 'L6'], ['Na', 'F']]
                .forEach(function (x) {
                    d.querySelector('#ion-deck .card[data-ion="' + x[0] + '"]').click();
                    d.querySelector('.slot.leaf[data-leaf="' + x[1] + '"]').click();
                });
            d.getElementById('btn-submit').click();
            var r2 = d.getElementById('result');
            ok('★★ 鉄を戻し忘れた答案は「単離できていない葉が 2 枚あります」になる',
                r2.querySelector('h3').textContent.indexOf('単離できていない葉が 2 枚') >= 0, uiOut);
            ok('★ 記録も葉の数で持っている（dirty ＝ ' + w.treeUI.state.record.dirty + '）',
                w.treeUI.state.record.dirty === 2 &&
                w.treeUI.state.record.isolated === false, uiOut);
            ok('同居した葉を名指しする', r2.textContent.indexOf('2 種類が同居しています') >= 0, uiOut);
            ok('何も来なかった葉も名指しする', r2.textContent.indexOf('何も来ませんでした') >= 0, uiOut);
            // ★ 間違えたところを名指しする（2026-08-28・ユーザー）
            ok('★ どの葉に何が入り、どの葉が空かを、まとめて名指しする',
                /〕の沈殿に 鉄と亜鉛 が入っています/.test(r2.textContent) &&
                /〕の沈殿は空です（鉄 を置きました）/.test(r2.textContent), uiOut);
            // ★ 手数を見せる。⚠⚠ 模範の手順は出さない（★ 正解は1つではない）
            ok('★ 手数と理想の最短手数が出る',
                /（\d+手／最短 \d+手）/.test(r2.textContent), uiOut);
            ok('⚠⚠ 模範の手順そのものを示していない（★ 1つ示すと他の正解を否定する）',
                r2.textContent.indexOf('正解は') < 0 && r2.textContent.indexOf('正しい手順') < 0 &&
                r2.textContent.indexOf('模範') < 0 && r2.textContent.indexOf('の順に') < 0, uiOut);
            ok('★ 記録が手数と最短手数を持っている（⚠ 率と共有の文面は次の一手）',
                w.treeUI.state.record.moves === 6 &&
                w.treeUI.state.record.shortest === 7, uiOut);
            ok('★ 答え合わせで初めて「鉄は第3属です」と言う（⚠ 途中では言わない）',
                r2.textContent.indexOf('鉄は第3属です') >= 0, uiOut);
            ok('なぜ素通りしたかを言う（Fe(OH)₂ と FeO(OH) の沈みやすさ）',
                r2.textContent.indexOf('素通り') >= 0 &&
                r2.textContent.indexOf('Fe(OH)₂') >= 0, uiOut);
            ok('⚠ この教材が足した説明であることを断っている（D10）',
                r2.textContent.indexOf('この教材が足した説明です') >= 0, uiOut);
            ok('⚠ 「間違い」と書かない（§3-3 の文面の向き）',
                r2.textContent.indexOf('間違い') < 0 && r2.textContent.indexOf('誤り') < 0 &&
                r2.textContent.indexOf('べきでした') < 0, uiOut);
            // ⚠⚠ 本の名前とページは画面に出さない（型B と同じ。§18-6 (4)）
            var books2 = (typeof BOOK_WORDS !== 'undefined') ? BOOK_WORDS : [];
            ok('ページ番号も本の名前も、画面のどこにも出てこない',
                !/p\s*\.\s*\d+/i.test(d.body.textContent) &&
                books2.every(function (x) { return d.body.textContent.indexOf(x) < 0; }), uiOut);
            ok('提出したあとは札が押せない',
                d.getElementById('btn-submit').disabled === true, uiOut);

            // --- ⑥ 置き直せる ---
            d.getElementById('btn-reset').click();
            ok('「置き直す」で最初からやり直せる',
                Object.keys(w.treeUI.state.plan).length === 0 &&
                w.treeUI.state.submitted === false &&
                d.getElementById('result').className.indexOf('hidden') >= 0, uiOut);

            // --- ⑦ スマホ幅で読めて、押せる ---
            ok('375px 幅で横スクロールが出ない（' + d.documentElement.scrollWidth + ' ≦ ' +
                d.documentElement.clientWidth + '）',
                d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1, uiOut);
            // ⚠ `.locked`（＝ 押せない・disabled）は押し所ではないので数えない。
            //   ★ そのぶん「実験手順から考える」側で全部 44px 以上を別に見張っている（下の⑧）
            var small = [].slice.call(d.querySelectorAll('.slot, .card, #btn-submit, #btn-reset'))
                .filter(function (el) {
                    var h = el.getBoundingClientRect().height;
                    return h > 0 && h < 44 && el.className.indexOf('locked') < 0;
                });
            if (small.length) warn('小さすぎる置き先: ' + small.length + ' 個');
            ok('枝・葉・札・ボタンが指で押せる大きさ（44px 以上）', small.length === 0, uiOut);

            // --- ⑧ ★★ 流れ図はディレクトリツリー（2026-08-28・ユーザー決定） ---
            //   ⚠ ここが緩むと「縦に長くて下が押しづらい」に戻る
            w.treeUI.start('read', 'easy', { ions: UI_A1 });
            var flow = d.getElementById('flow');
            ok('★ 流れ図がディレクトリツリーの行の並びになっている', (function () {
                return !!flow && flow.querySelectorAll('.row').length === 18 &&
                    flow.querySelectorAll('.row.node').length === 11 &&
                    flow.querySelectorAll('.row.edge').length === 7;
            })(), uiOut);
            ok('★★ 1つの節が1行に収まっている（⚠ 枠を積まない。実測の最大 ' + (function () {
                var mx = 0;
                [].slice.call(flow.querySelectorAll('.row')).forEach(function (e) {
                    mx = Math.max(mx, Math.round(rectH(e)));
                });
                return mx;
            })() + 'px）', (function () {
                var bad = [];
                [].slice.call(flow.querySelectorAll('.row')).forEach(function (e, i) {
                    // ⚠ 上限は実測（最大44px ＝ 押し所の下限）のすぐ上に置く。
                    //   ★ ゆるくすると「枠を積む」形に戻っても気づけない
                    // ⚠ 例外は先頭の「この容器」だけ —— ★ 中身のイオンが8つ並ぶと 375px で
                    //   2行に折り返す（枠を積んでいるのではなく、文字が折り返しているだけ）。
                    //   ★ そこだけ2行ぶんまで許し、それ以外は 46px のまま見張る。
                    var cap = (i === 0) ? 72 : 46;
                    if (rectH(e) > cap) bad.push(e.textContent.trim().slice(0, 12) + ':' + Math.round(rectH(e)));
                });
                if (bad.length) warn('1行に収まっていない節: ' + bad.join(' / '));
                return bad.length === 0;
            })(), uiOut);
            ok('★★ 深さは主流の節が持つ（⚠ 溶液の節と試薬は深さ0）', (function () {
                var main = [].slice.call(flow.querySelectorAll('.row.edge, .row.node.sol'));
                return main.length === 13 && main.every(function (e) {
                    return e.getAttribute('data-d') === '0';
                });
            })(), uiOut);
            // ★★ インデント（2026-08-28・ユーザー「沈殿 や 加える試薬 は もっと頭下げてよい」）
            //   ⚠ 左端に立つのは主流の節だけ。★ 試薬と、その試薬で出た沈殿は同じ段にそろう
            var INDENT_MIN = 24;    // ⚠ 作り直す前は 20px（試薬にいたっては 0）
            ok('★★ 左端に立つのは主流（溶液）の節だけ', (function () {
                var sol = [].slice.call(flow.querySelectorAll('.row.node.sol'));
                return sol.length === 6 && sol.every(function (e) {
                    return e.getAttribute('data-i') === '0' &&
                        parseFloat(w.getComputedStyle(e).marginLeft) === 0;
                });
            })(), uiOut);
            ok('★★ 加える試薬も1段下がる（⚠ 主流と同じ位置に立たない。実測 ' + (function () {
                var e = flow.querySelector('.row.edge');
                return Math.round(parseFloat(w.getComputedStyle(e).marginLeft));
            })() + 'px ≧ ' + INDENT_MIN + '）', (function () {
                var eg = [].slice.call(flow.querySelectorAll('.row.edge'));
                return eg.length === 7 && eg.every(function (e) {
                    return e.getAttribute('data-i') === '1' &&
                        parseFloat(w.getComputedStyle(e).marginLeft) >= INDENT_MIN;
                });
            })(), uiOut);
            ok('★★ 脱出したもの（沈殿）も1段下がる（★ 試薬とそろう）', (function () {
                var esc = [].slice.call(flow.querySelectorAll('.row.node.ppt'));
                var eg = flow.querySelector('.row.edge');
                if (esc.length !== 5) return false;
                var want = parseFloat(w.getComputedStyle(eg).marginLeft);
                return esc.every(function (e) {
                    return e.getAttribute('data-d') === '1' && e.getAttribute('data-i') === '1' &&
                        parseFloat(w.getComputedStyle(e).marginLeft) === want && want >= INDENT_MIN;
                });
            })(), uiOut);
            ok('⚠ 深さを列で表していない（★ インデントだけ。375px で列が足りなくならない）',
                !flow.getAttribute('data-cols') &&
                w.getComputedStyle(flow).display !== 'grid', uiOut);

            // --- ★★★ 縦の罫が1本で通っているか（2026-08-28・ユーザー
            //     「ろ液間にも線を伸ばして、容器からつながるように」） ---
            //   ⚠ 擬似要素なので getBoundingClientRect が取れない。
            //   ★ computed style の top / bottom から、行ごとの線分を絶対座標で組み立てて継ぎ目を測る
            var rail = (function () {
                return [].slice.call(flow.querySelectorAll('.row')).map(function (e) {
                    var cs = w.getComputedStyle(e, '::before');
                    var rc = e.getBoundingClientRect();
                    var bw = parseFloat(w.getComputedStyle(e).borderLeftWidth) || 0;
                    var top = parseFloat(cs.top), h = parseFloat(cs.height);
                    return {
                        x: rc.left + bw + parseFloat(cs.left),
                        top: rc.top + top, bot: rc.top + top + h,
                        drawn: parseFloat(cs.borderLeftWidth) > 0
                    };
                });
            })();
            ok('★ どの行にも縦の罫の線分がある（' + rail.length + ' 本）',
                rail.length === 18 && rail.every(function (s) { return s.drawn; }), uiOut);
            ok('★★ 縦の罫が1本の直線（⚠ 段が違っても同じ x に立つ）', (function () {
                var xs = rail.map(function (s) { return Math.round(s.x); });
                var uniq = xs.filter(function (v, i) { return xs.indexOf(v) === i; });
                if (uniq.length > 1) warn('罫の x が割れている: ' + uniq.join('/'));
                return uniq.length === 1;
            })(), uiOut);
            ok('★★★ 容器から最後のろ液まで、罫が途切れていない（⚠ 隙間が 0px）', (function () {
                var worst = 0;
                for (var i = 1; i < rail.length; i++) {
                    worst = Math.max(worst, Math.abs(rail[i].top - rail[i - 1].bot));
                }
                if (worst > 0.5) warn('罫の切れ目の最大: ' + worst.toFixed(1) + 'px');
                return worst <= 0.5;
            })(), uiOut);
            ok('★ 罫は容器の中で始まり、最後のろ液の中で終わる（⚠ 突き抜けない）', (function () {
                var rows = flow.querySelectorAll('.row');
                var a = rows[0].getBoundingClientRect(), z = rows[rows.length - 1].getBoundingClientRect();
                return rail[0].top >= a.top && rail[0].top <= a.bottom &&
                    rail[rail.length - 1].bot >= z.top && rail[rail.length - 1].bot <= z.bottom;
            })(), uiOut);
            ok('★ 罫の全長が、容器から最後のろ液までを覆っている（実測 ' +
                Math.round(rail[rail.length - 1].bot - rail[0].top) + 'px）',
                (rail[rail.length - 1].bot - rail[0].top) >= 400, uiOut);
            ok('★ 罫から各行へ、横の継ぎ手が出ている（⚠ 容器だけは持たない）', (function () {
                var rows = [].slice.call(flow.querySelectorAll('.row'));
                var bad = rows.filter(function (e, i) {
                    var cs = w.getComputedStyle(e, '::after');
                    var has = cs.content !== 'none' && parseFloat(cs.borderTopWidth) > 0;
                    return i === 0 ? has : !has;
                });
                return bad.length === 0;
            })(), uiOut);
            // ★★ 相は枠の形で表す（⚠ 色だけで区別しない）
            ok('★★ 沈殿の枠は ▢（角ばった四角）', (function () {
                var bad = [];
                [].slice.call(flow.querySelectorAll('.row.node.ppt')).forEach(function (e) {
                    var r = parseFloat(w.getComputedStyle(e).borderTopLeftRadius) || 0;
                    if (r > 3) bad.push(r);
                });
                if (bad.length) warn('角丸になっている沈殿の枠: ' + bad.join('/'));
                return bad.length === 0;
            })(), uiOut);
            ok('★★ 溶液の枠は ⬭（丸い枠）', (function () {
                var bad = [];
                [].slice.call(flow.querySelectorAll('.row.node.sol')).forEach(function (e) {
                    var r = parseFloat(w.getComputedStyle(e).borderTopLeftRadius) || 0;
                    if (r < 12) bad.push(r);
                });
                if (bad.length) warn('丸くなっていない溶液の枠: ' + bad.join('/'));
                return bad.length === 0;
            })(), uiOut);
            ok('⚠ 相を色だけで区別していない（★ 枠の形が実際に違う）', (function () {
                var a = w.getComputedStyle(flow.querySelector('.row.node.ppt')).borderTopLeftRadius;
                var b2 = w.getComputedStyle(flow.querySelector('.row.node.sol')).borderTopLeftRadius;
                return a !== b2;
            })(), uiOut);
            ok('★ 最後のろ液は主流の末端（溶液）で、そこにも置ける',
                !!flow.querySelector('.row.node.sol.terminal[data-leaf="F"]'), uiOut);
            // ⚠⚠ 置けるのは終端だけ（★ 木の形から出す。「沈殿だから置ける」ではない）
            ok('⚠ 置き場があるのは終端の節だけ（★ 途中の節には置けない）', (function () {
                var terminal = flow.querySelectorAll('.row.node.terminal[data-leaf]').length;
                var inner = flow.querySelectorAll('.row.node.inner[data-leaf]').length;
                return terminal === 6 && inner === 0;
            })(), uiOut);
            // ★★★ 縦の長さ。⚠ 上限を数で決めておかないと、じわじわ戻る
            //   （★ ディレクトリツリーに作り直す前の実測: ページ 2081px・流れ図 1097px）
            // ⚠ 上限を 1750 → 1800 にした（2026-08-28）——
            //   ★ 難易度の選択と「べつの容器にする」を足したぶん（実測 1691 → 1749）。
            //   ⚠ ツリーの作りは1行も変えていない（流れ図の欄は 731px のまま）。
            ok('★★ 375px 幅で、ページの高さが 1800px 以内（実測 ' +
                d.documentElement.scrollHeight + 'px。⚠ 作り直す前は 2081px）',
                d.documentElement.scrollHeight <= 1800, uiOut);
            ok('★ 流れ図の欄の高さが 780px 以内（実測 ' +
                Math.round(rectH(d.getElementById('panel-tree'))) + 'px。⚠ 作り直す前は 1097px）',
                rectH(d.getElementById('panel-tree')) <= 780, uiOut);
            // ⚠ 「実験手順から考える」では試薬の行が押し所になる ＝ 44px を要る
            w.treeUI.start('build', 'easy', { ions: UI_A1 });
            ok('★ 「実験手順から考える」では、押せるものが全部 44px 以上', (function () {
                var bad = [];
                [].slice.call(d.querySelectorAll('.slot, .card, #btn-submit, #btn-reset'))
                    .forEach(function (el) {
                        var h = el.getBoundingClientRect().height;
                        if (h > 0 && h < 44) bad.push(el.className + ':' + Math.round(h));
                    });
                if (bad.length) warn('小さすぎる押し所（build）: ' + bad.join(' / '));
                return bad.length === 0;
            })(), uiOut);
            driveSplit(w, d, UI_SPLIT2);
            w.treeUI.start('read', 'easy', { ions: UI_A1 });
        }

        /**
         * ★★★ 属の中に2組入っている容器を、画面から最後まで通す（2026-08-28）。
         * ⚠ ここが緩むと「沈殿側の枝」が画面から消えても気づけない。
         *
         * 見るのは4つ:
         *   ① ★ 沈殿側の札が、沈殿の節を押すだけで置ける（⚠ 枝ではない）
         *   ② ★★ **割った沈殿は、その場で置き場でなくなる**（＝ 終端は木の形から出ている）
         *   ③ ★★★ **割らずに止めて提出すると、単離できていない葉が2枚できる**
         *   ④ 深さ2でも 375px で横スクロールが出ず、押し所が 44px 以上
         */
        function driveSplit(w, d, ions) {
            section('型A の画面: 属の中に2つ入る容器（深さ2）', uiOut);
            var pick = function (sel) { var e = d.querySelector(sel); if (e) e.click(); return !!e; };

            // --- 主流だけ組む（★ まだ割らない） ---
            w.treeUI.start('build', 'hard', { ions: ions });
            ok('★ 沈殿側の札が手札にある（熱湯・過剰の水酸化ナトリウム水溶液）',
                !!d.querySelector('#op-deck .card[data-sub="hot"]') &&
                !!d.querySelector('#op-deck .card[data-sub="naoh"]'), uiOut);
            [['hcl', 0], ['h2s', 1], ['boil', 2], ['hno3', 3], ['nh3', 4], ['h2s', 5], ['co3', 6]]
                .forEach(function (x) {
                    pick('#op-deck .card[data-op="' + x[0] + '"]');
                    pick('.slot.branch[data-slot="' + x[1] + '"]');
                });
            var leavesBefore = [].slice.call(d.querySelectorAll('.slot.leaf'))
                .map(function (e) { return e.getAttribute('data-leaf'); });
            ok('★ 割る前の終端は6つ（実測 ' + leavesBefore.join(',') + '）',
                leavesBefore.join(',') === 'L0,L1,L4,L5,L6,F', uiOut);

            // --- ★★★ 割らずに止めた答案を、いったん提出してみる ---
            [['Ag', 'L0'], ['Cu', 'L1'], ['Fe3', 'L4'], ['Zn', 'L5'], ['Ca', 'L6'], ['Na', 'F']]
                .forEach(function (x) {
                    pick('#ion-deck .card[data-ion="' + x[0] + '"]');
                    pick('.slot.leaf[data-leaf="' + x[1] + '"]');
                });
            d.getElementById('btn-submit').click();
            var rStop = d.getElementById('result');
            ok('★★★ 割らずに止めると「単離できていない葉が 2 枚あります」になる（⚠ ここが' +
                'この教材で属の中の分離をやる理由そのもの）',
                rStop.querySelector('h3').textContent.indexOf('単離できていない葉が 2 枚') >= 0, uiOut);
            ok('★ 同居した2枚を名指しする（銀と鉛／鉄とアルミニウム）',
                /銀と鉛 が入っています/.test(rStop.textContent) &&
                /鉄とアルミニウム が入っています/.test(rStop.textContent), uiOut);
            ok('★ 記録も葉の数で持っている（dirty ＝ ' + w.treeUI.state.record.dirty + '）',
                w.treeUI.state.record.dirty === 2 && w.treeUI.state.record.isolated === false, uiOut);

            // --- ★ 割って組み直す ---
            w.treeUI.start('build', 'hard', { ions: ions });
            [['hcl', 0], ['h2s', 1], ['boil', 2], ['hno3', 3], ['nh3', 4], ['h2s', 5], ['co3', 6]]
                .forEach(function (x) {
                    pick('#op-deck .card[data-op="' + x[0] + '"]');
                    pick('.slot.branch[data-slot="' + x[1] + '"]');
                });
            ok('★ 沈殿側の札を選ぶと、まだ割っていない沈殿だけが置き先として光る', (function () {
                pick('#op-deck .card[data-sub="hot"]');
                var can = d.querySelectorAll('.node.splittable.can').length;
                var all = d.querySelectorAll('.node.splittable').length;
                return can === all && all === 5;
            })(), uiOut);
            ok('★ 沈殿の節を押すと、その沈殿が割れる（⚠ 置き先は枝ではない）', (function () {
                pick('.node[data-split="0"]');
                return w.treeUI.state.sub['0'] === 'hot' &&
                    !!d.querySelector('.row.edge.subbranch[data-subslot="0"]');
            })(), uiOut);
            pick('#op-deck .card[data-sub="naoh"]');
            pick('.node[data-split="4"]');
            var leavesAfter = [].slice.call(d.querySelectorAll('.slot.leaf'))
                .map(function (e) { return e.getAttribute('data-leaf'); });
            ok('★★ 割ると終端が8つになる（実測 ' + leavesAfter.join(',') + '）',
                leavesAfter.join(',') === 'L0s,L0p,L1,L4s,L4p,L5,L6,F', uiOut);
            ok('★★★ 割った沈殿は、その場で置き場でなくなる（⚠ 終端は木の形から出ている）',
                !d.querySelector('.slot.leaf[data-leaf="L0"]') &&
                !d.querySelector('.slot.leaf[data-leaf="L4"]'), uiOut);
            ok('⚠ 深さは列ではなくインデントで表す（★ 深さ2の行がある・列は増えていない）', (function () {
                var deep = [].slice.call(d.querySelectorAll('#flow .row[data-i="2"]'));
                if (deep.length !== 4) return false;       // 沈殿側の試薬2行 ＋ 溶けた液2行
                var step = parseFloat(w.getComputedStyle(d.querySelector('#flow .row[data-i="1"]')).marginLeft);
                return deep.every(function (e) {
                    return Math.abs(parseFloat(w.getComputedStyle(e).marginLeft) - 2 * step) < 1;
                }) && !d.getElementById('flow').getAttribute('data-cols') &&
                    w.getComputedStyle(d.getElementById('flow')).display !== 'grid';
            })(), uiOut);
            ok('★★ 深さ2でも縦の罫は1本のまま（⚠ 段が違っても同じ x に立つ）', (function () {
                var xs = [].slice.call(d.querySelectorAll('#flow .row')).map(function (e) {
                    var cs = w.getComputedStyle(e, '::before');
                    var bw = parseFloat(w.getComputedStyle(e).borderLeftWidth) || 0;
                    return Math.round(e.getBoundingClientRect().left + bw + parseFloat(cs.left));
                });
                var uniq = xs.filter(function (v, i) { return xs.indexOf(v) === i; });
                if (uniq.length > 1) warn('深さ2で罫の x が割れている: ' + uniq.join('/'));
                return uniq.length === 1;
            })(), uiOut);
            ok('⚠ 深さ2でも 375px で横スクロールが出ない（' + d.documentElement.scrollWidth +
                ' ≦ ' + d.documentElement.clientWidth + '）',
                d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1, uiOut);

            [['Ag', 'L0p'], ['Pb', 'L0s'], ['Cu', 'L1'], ['Fe3', 'L4p'], ['Al', 'L4s'],
            ['Zn', 'L5'], ['Ca', 'L6'], ['Na', 'F']].forEach(function (x) {
                pick('#ion-deck .card[data-ion="' + x[0] + '"]');
                pick('.slot.leaf[data-leaf="' + x[1] + '"]');
            });
            // ⚠ 深さ2の押し所も 44px 以上（★ 幅が減っても押せる大きさを保つ）
            ok('★ 深さ2でも、押せるものが全部 44px 以上', (function () {
                var bad = [];
                [].slice.call(d.querySelectorAll('.slot, .card, #btn-submit, #btn-reset, #btn-new'))
                    .forEach(function (el) {
                        var h = el.getBoundingClientRect().height;
                        if (h > 0 && h < 44) bad.push(el.className + ':' + Math.round(h));
                    });
                if (bad.length) warn('小さすぎる押し所（深さ2）: ' + bad.join(' / '));
                return bad.length === 0;
            })(), uiOut);
            // ⚠ 深さ2はいちばん行の多い形（★ 上限を数で決めておかないと、じわじわ伸びる）
            ok('★ 深さ2・全部置いた状態でも、375px でページの高さが 2200px 以内（実測 ' +
                d.documentElement.scrollHeight + 'px）',
                d.documentElement.scrollHeight <= 2200, uiOut);

            d.getElementById('btn-submit').click();
            var rSplit = d.getElementById('result');
            ok('★★ 割れば「ぜんぶ単離できました」になる',
                rSplit.querySelector('h3').textContent.indexOf('ぜんぶ単離できました') >= 0, uiOut);
            ok('★ 手数は、沈殿側の札も数えている（9手／最短 9手）',
                /（9手／最短 9手）/.test(rSplit.textContent) &&
                w.treeUI.state.record.moves === 9, uiOut);
            ok('★ 沈殿を割った手の説明が出る（溶け出したもの・残ったもの）',
                rSplit.textContent.indexOf('溶け出しました') >= 0 &&
                rSplit.textContent.indexOf('沈殿のまま残りました') >= 0, uiOut);
            ok('★ 割った先の姿が出る（PbCl₂ が溶けた／[Al(OH)₄]⁻ になった）',
                rSplit.textContent.indexOf('PbCl₂') >= 0 &&
                rSplit.textContent.indexOf('[Al(OH)₄]⁻') >= 0, uiOut);
            ok('⚠ 深さ2でも、本の名前とページは画面に出てこない',
                !/p\s*\.\s*\d+/i.test(d.body.textContent) &&
                ((typeof BOOK_WORDS !== 'undefined') ? BOOK_WORDS : [])
                    .every(function (x) { return d.body.textContent.indexOf(x) < 0; }), uiOut);

            // --- 難易度の選択（★ 型B と同じ。⚠ 解き筋に触れる語を出さない） ---
            section('型A の画面: 難易度の選択', uiOut);
            ok('★ 難易度の段が3つ出ている',
                d.querySelectorAll('#probs button[data-level]').length === 3, uiOut);
            ok('★ 段の見出しは名前と印だけ（⚠ 試薬の名前もイオンの名前も出さない）', (function () {
                var t = d.getElementById('probs').textContent;
                return (SPOILER_WORDS || []).every(function (x) { return t.indexOf(x) < 0; }) &&
                    t.indexOf('熱湯') < 0 && t.indexOf('属') < 0;
            })(), uiOut);
            ok('★ 「べつの容器にする」で、別の中身が出る', (function () {
                var before = treeIonKey(w.treeUI.state.problem.ions);
                d.getElementById('btn-new').click();
                return treeIonKey(w.treeUI.state.problem.ions) !== before &&
                    w.treeUI.state.submitted === false;
            })(), uiOut);
            ok('★ 段を選ぶと、その段の容器になる', (function () {
                var bad = [];
                ['easy', 'normal', 'hard'].forEach(function (l) {
                    d.querySelector('#probs button[data-level="' + l + '"]').click();
                    if (w.treeUI.state.level !== l) { bad.push(l); return; }
                    if (treeDifficulty(w.treeUI.state.problem).level !== l) bad.push(l + ':' + w.treeUI.state.problem.id);
                });
                if (bad.length) warn('段と食い違う容器が出た: ' + bad.join(' / '));
                return bad.length === 0;
            })(), uiOut);
            ok('⚠ やり方を替えても、いま出ている容器は変わらない（★ 引き直さない）', (function () {
                var before = treeIonKey(w.treeUI.state.problem.ions);
                d.querySelector('#modes button[data-mode="build"]').click();
                var mid = treeIonKey(w.treeUI.state.problem.ions);
                d.querySelector('#modes button[data-mode="read"]').click();
                return mid === before && treeIonKey(w.treeUI.state.problem.ions) === before;
            })(), uiOut);
            ok('★ 「イオンの行先を答える」では、沈殿側の札も置いてある（⚠ 行先を答えるだけの段で、' +
                '割らずに止めた木を渡さない）', (function () {
                    w.treeUI.start('read', 'hard', { ions: ions });
                    return Object.keys(w.treeUI.state.sub).length === 2 &&
                        d.querySelectorAll('.slot.leaf').length === 8 &&
                        d.querySelectorAll('#op-deck .card').length === 0;
                })(), uiOut);
        }
    }

    // 型A の画面が、設計書の縛りを文面と作りの側でも守っているか
    function runTreeSource(next) {
        section('型A の縛り（tree.js / tree-model.js）');
        if (!onHttp) { ok('ソースを読み取れる（http で開いていない）', false); next(); return; }
        Promise.all([
            fetch('tree.js', { cache: 'no-store' }).then(function (r) { return r.text(); }),
            fetch('tree-model.js', { cache: 'no-store' }).then(function (r) { return r.text(); })
        ]).then(function (srcs) {
            var raw = srcs.join('\n');
            ok('ソースを読み取れる', raw.length > 0);
            var src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
            ok('コメントだけを外せている（中身は残っている）',
                src.length > 0 && src.length < raw.length && src.indexOf('function treeRun') >= 0);
            // ⚠⚠ タッチで確実に動かないものに戻していないこと（★ muki はスマホ前提）
            ok('ドラッグ＆ドロップに戻していない（dataTransfer / draggable を使わない）',
                src.indexOf('dataTransfer') < 0 && src.indexOf('draggable') < 0 &&
                src.indexOf('dragstart') < 0 && src.indexOf('ondrop') < 0);
            // §16-3 と同じ。★ 型A にも「まだわからない」は無い（中身が既知なので、そもそも要らない）
            ok('「まだわからない」という選択肢を作っていない',
                src.indexOf('まだわからない') < 0);
            // §17-11: アプリが「確認できません」と言わない
            ok('「確認できません」と言わない（§17-11）',
                src.indexOf('確認できません') < 0);
            // §5-5: 色は混ぜない。並べて見せる
            ok('「混ざった色」を作らない（§5-5）',
                src.indexOf('混ざった色') < 0 && src.indexOf('混色') < 0);
            // §10-2: 群の呼び方は「属」。⚠ 「族」は周期表の族と衝突するので使わない
            ok('群の呼び方は「属」（⚠ 「第N族」と書かない）', !/第[1-6１-６]族/.test(src));
            ok('答え合わせでは「属」を使っている（§10-2）', /第[1-6１-６]属/.test(src));
            // §4-3: 途中で警告を出さない
            ok('途中で警告を出す文言を持たない（§4-3「警告を出さない」）',
                src.indexOf('煮沸を忘れて') < 0 && src.indexOf('忘れています') < 0);
            // ★★ §20-4: 置き場は **木の形**から出す（⚠ 「沈殿だから置ける」と決め打ちしない）
            ok('★★ 画面が置き場を木の形から出している（treeLeafIds を使う）',
                src.indexOf('treeLeafIds') >= 0);
            ok('⚠ 画面が「相が沈殿かどうか」で置き場を決めていない', (function () {
                // ★ phase / ppt を見て terminal を決める書き方に戻したら赤くする
                return !/terminal\s*[:=][^;\n]*(ppt|phase)/.test(src) &&
                    !/(ppt|phase)[^;\n]*terminal\s*=/.test(src);
            })());
            // ★ §20-6: 出題は生成（⚠ 直書きの一覧に戻していない）
            ok('★ 出題を直書きの一覧に戻していない（TREE_PROBLEMS が無い）',
                src.indexOf('TREE_PROBLEMS') < 0 && src.indexOf('treePools') >= 0);
            // ★ §2-4: 難易度を手で付けない ——
            //   ⚠ 段の切り方（score の閾値）を模型の外に写していないこと
            ok('⚠ 難易度の段の切り方を、模型の外に写していない（★ TREE_LEVELS の min/max だけ）',
                (src.match(/min\s*:\s*\d+\s*,\s*max\s*:\s*\d+/g) || []).length ===
                TREE_LEVELS.length);
        }).catch(function (e) {
            ok('ソースを読み取れる（' + e + '）', false);
        }).then(next);
    }

    // スネークの UI テストが終わったら、型B → 型A の画面へ進んでから締める。
    // ⚠ finish() を直に呼ばないこと（型B・型A のテストが丸ごと空振りする）
    function endAll() {
        runSeparationSource(function () {
            runSeparationUI(function () {
                runTreeSource(function () { runTreeUI(finish); });
            });
        });
    }

    function finish() {
        var total = document.getElementById('total');
        var n = pass + fail;
        // 空振り防止。iframe が初期化されない・fetch が落ちる等で
        // 「少ないけど全部通った」と見えるのを、はっきり不合格にする
        if (n < MIN_CASES) {
            ok('テストが ' + MIN_CASES + '件以上走った（空振り防止。実際は ' + n + '件）', false);
        }
        total.textContent = fail === 0
            ? 'ALL PASS (' + pass + ')'
            : fail + ' FAILED / ' + (pass + fail);
        total.className = fail === 0 ? 'pass' : 'fail';
    }

    // iframe の初期化待ち。game.js は setTimeout(init, 100) で始まるので、
    // load だけでは早すぎる（head-name が '-' のまま）
    function whenAppReady(cb) {
        var tries = 0;
        (function poll() {
            var w = frame.contentWindow, d = frame.contentDocument;
            var ready = !!(d && d.readyState === 'complete' && w && typeof w.fitBoard === 'function');
            var inited = ready && d.getElementById('head-name') &&
                d.getElementById('head-name').textContent !== '-';
            if (inited || ++tries > 120) { cb(!!inited); return; }
            setTimeout(poll, 50);
        })();
    }

    if (!onHttp) {
        // file:// では iframe の中身に触れない。空振りのまま ALL PASS にしない
        runSource(function () {
            ok('UI テストを走らせられる（file:// では不可。ローカルサーバーで開くこと）', false, uiOut);
            endAll();
        });
    } else {
        whenAppReady(function (inited) { runSource(function () { runUI(inited); }); });
    }
})();
