// 参考書から来たときの戻り道（2026-09-19・参考書を無機・理論へ広げる 便0b）
//
// CLAUDE.md「アプリ横断のリンクは往復にする」。参考書（/reference/）の :::link app: muki/* は
// `?from=reference&page=<ページid>` を付けて来る。★ 各ページのトップバー（.topbar）に
// 「← 参考書へ戻る」を1本足す。muki には全ページ共通のスクリプトが無いので、この1本を各ページが読む。
//   ⚠ 知ってよいのは相手の URL の形（`/reference/<ページid>/`）だけ。読めない page は索引へ戻す
//   ⚠ `.topbar .hubLink` の**1本目はハブ**のまま（tests.js が見ている）。その直後に足す
//   ⚠ シェア（game.js の shareUrl）には載せない —— こちらは帯を出すだけ（URL を作り替えない）
//   ⚠ `_top` ＝ 埋め込まれていても、タブごと参考書へ戻す（qa の帯と同じ）
(function () {
    'use strict';
    function refBack() {
        try {
            var p = new URLSearchParams(location.search);
            var bar = document.querySelector('.topbar');
            if (p.get('from') !== 'reference' || !bar || bar.querySelector('.refBackLink')) return null;
            var page = p.get('page') || '';
            var a = document.createElement('a');
            a.className = 'hubLink refBackLink';
            a.href = '../reference/' + (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(page) ? page + '/' : '');
            a.target = '_top';
            a.textContent = '← 参考書へ戻る';
            // ハブ（1本目）のすぐ後ろ ＝ 来た道をいちばん目に付く所に置く
            var hub = bar.querySelector('.hubLink');
            bar.insertBefore(a, hub ? hub.nextSibling : bar.firstChild);
            return a;
        } catch (e) { return null; }   // 戻り道が作れなくても本体は動かす
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', refBack);
    else refBack();
})();
