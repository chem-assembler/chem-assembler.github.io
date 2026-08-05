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
    var MIN_CASES = 70;

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
    ok('もう「淡黄」と名乗る沈殿はない（名乗りと色の乖離を作り直さない）',
        P.every(function (p) { return p.name.indexOf('淡黄') < 0; }));
    var noted = P.filter(function (p) { return p.note; });
    ok('note を持つのは Ag₂CO₃ だけ（他の沈殿には何も出ない）',
        noted.length === 1 && noted[0].formula === 'Ag₂CO₃');
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
            finish();
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
            finish();
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
            finish();
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
        }).catch(function (e) {
            ok('game.js を読み取れる（' + e + '）', false);
        }).then(next);
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
            finish();
        });
    } else {
        whenAppReady(function (inited) { runSource(function () { runUI(inited); }); });
    }
})();
