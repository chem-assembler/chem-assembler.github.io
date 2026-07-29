/* report.js — 控えめな「報告」入口。1ページ1つだけ設置する。
 *
 * 方針: 要素ごとにボタンを置くと鬱陶しいので、固定の小さなボタンを1つだけ置き、
 *        文脈（どのページ・いま見ている問題）はクリック時にアプリ状態から自動で拾う。
 *        アプリ側で window.__reportContext() を定義すると精密な文脈（問題コード等）を渡せる。
 *
 * 使い方（各アプリ共通）:
 *   1) このファイルを読み込む（例: <script src="report.js?v=1"></script>）
 *   2) 任意で window.__reportContext = function(){ return {page, locus, version}; } を定義
 *   3) 下の FORM 設定に Google フォームの viewUrl と entry ID を入れると本番送信になる
 *      （未設定のうちは「送信予定の内容」をプレビュー表示するだけ＝設置確認用）
 */
(function () {
  'use strict';

  // ===== 設定：Google フォーム作成後にここを埋める =====
  var FORM = {
    viewUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSerLQFPAyrMq0vqm8LRtJvDFKY69Hk1zg_h6bvKRQjD3u0-Sg/viewform',
    entry: {
      page: 'entry.456672800',     // アプリ／ページ
      locus: 'entry.1035283203',   // 場所（問題コード等）
      version: 'entry.737163982'   // バージョン
      // 「どこが気になりますか？」(entry.135590934) はユーザーが手入力するので prefill 不要
    }
  };
  // ====================================================

  function ctx() {
    var c = (typeof window.__reportContext === 'function') ? (window.__reportContext() || {}) : {};
    return {
      page: c.page || document.title || location.pathname,
      locus: c.locus || '(このページ全体)',
      version: c.version || ''
    };
  }

  function openForm() {
    var c = ctx();
    if (!FORM.viewUrl) { preview(c); return; }
    var u = new URL(FORM.viewUrl);
    if (FORM.entry.page) u.searchParams.set(FORM.entry.page, c.page);
    if (FORM.entry.locus) u.searchParams.set(FORM.entry.locus, c.locus);
    if (FORM.entry.version) u.searchParams.set(FORM.entry.version, c.version);
    window.open(u.toString(), '_blank', 'noopener');
  }

  // フォーム未設定時：送信予定の文脈を表示（設置と自動取得の確認用）
  function preview(c) {
    var old = document.getElementById('report-preview');
    if (old) old.remove();
    var box = document.createElement('div');
    box.id = 'report-preview';
    box.innerHTML =
      '<div class="rp-card">' +
      '<div class="rp-h">報告フォーム（準備中）に渡す内容</div>' +
      '<dl><dt>ページ</dt><dd>' + esc(c.page) + '</dd>' +
      '<dt>場所</dt><dd>' + esc(c.locus) + '</dd>' +
      '<dt>バージョン</dt><dd>' + esc(c.version || '—') + '</dd></dl>' +
      '<p class="rp-note">フォーム作成後、report.js の FORM 設定を埋めると本番送信になります。</p>' +
      '<button type="button" class="rp-close">閉じる</button></div>';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      if (e.target === box || e.target.classList.contains('rp-close')) box.remove();
    });
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function inject() {
    if (document.getElementById('report-btn')) return;
    var style = document.createElement('style');
    style.textContent =
      '#report-btn{position:fixed;right:14px;bottom:14px;z-index:60;display:inline-flex;align-items:center;gap:6px;' +
      'padding:8px 12px;font-size:13px;font-weight:700;border-radius:999px;cursor:pointer;' +
      'color:var(--ink,#0f171c);background:var(--surface,#fff);border:1px solid var(--line-strong,#c7d1d5);' +
      'box-shadow:0 2px 8px rgba(0,0,0,.14);opacity:.62;transition:opacity .15s ease,transform .15s ease}' +
      '#report-btn:hover,#report-btn:focus-visible{opacity:1;transform:translateY(-1px)}' +
      '@media(max-width:640px){#report-btn{right:10px;bottom:10px;padding:7px 10px;font-size:12px}}' +
      '#report-preview{position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;' +
      'background:rgba(0,0,0,.5);padding:20px}' +
      '#report-preview .rp-card{background:var(--surface,#fff);color:var(--ink,#0f171c);max-width:420px;width:100%;' +
      'border:1px solid var(--line,#dde4e7);border-radius:14px;padding:20px;box-shadow:0 20px 50px rgba(0,0,0,.4)}' +
      '#report-preview .rp-h{font-weight:800;margin-bottom:12px}' +
      '#report-preview dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0 0 12px;font-size:14px}' +
      '#report-preview dt{color:var(--ink-soft,#4d5a62);font-weight:700}' +
      '#report-preview dd{margin:0;word-break:break-all}' +
      '#report-preview .rp-note{font-size:12px;color:var(--ink-faint,#7d8a91);margin:0 0 14px}' +
      '#report-preview .rp-close{padding:8px 18px;border-radius:8px;border:1px solid var(--line-strong,#c7d1d5);' +
      'background:var(--surface-2,#f6f9fa);color:inherit;font-weight:700;cursor:pointer}';
    document.head.appendChild(style);

    var btn = document.createElement('button');
    btn.id = 'report-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', '気づいたことを報告する');
    btn.innerHTML = '<span aria-hidden="true">🐛</span> 報告';
    btn.addEventListener('click', openForm);
    document.body.appendChild(btn);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();
