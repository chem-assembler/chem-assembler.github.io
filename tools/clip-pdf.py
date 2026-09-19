#!/usr/bin/env python
"""
スライドの PDF から図を切り出して PNG に焼く（参考書の図・DESIGN_reference_book.md §19-4）。

  # 1) 位置を決める: 頁まるごとを 10% 刻みの格子つきで描く（目で見て範囲を読む）
  python tools/clip-pdf.py grid  <pdf> <頁(1始まり)> <出力.png>

  # 2) 切って焼く: 範囲は頁に対する割合 0〜1（左,上,右,下）
  python tools/clip-pdf.py clip  <pdf> <頁> <x0,y0,x1,y1> <出力.png> [--width=1200]

  # （別の便が 150dpi の画素で範囲を書いていたとき）
  python tools/clip-pdf.py clip  <pdf> <頁> <x0,y0,x1,y1> <出力.png> --px-dpi=150

★ なぜ在るか: 理論のドラフト便（2026-09-19）が8便とも「PDF を切る道具が無い」で図を
  `//図:` に回した。レーンは使い捨てのスクリプトを書かない決まり（承認待ちでキャッシュが切れる）
  なので、**1本の道具にして使い回す**。
⚠ 幅は既定 1200px（§19-4 の容量の目安）。焼いたら大きさを表示する。100KB を超えたら範囲を絞る。
⚠ 写真・キャラクターの図は焼かない（ユーザーが描いた図だけ）—— これは道具では見分けられない。
"""
import sys

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.exit('PyMuPDF (fitz) が要ります: pip install pymupdf')


def opt(name, default=None):
    for a in sys.argv:
        if a.startswith('--' + name + '='):
            return a.split('=', 1)[1]
    return default


def page_of(pdf, n):
    doc = fitz.open(pdf)
    if not 1 <= n <= doc.page_count:
        sys.exit(f'頁 {n} がありません（全 {doc.page_count} 頁）')
    return doc, doc[n - 1]


def cmd_grid(pdf, n, out):
    doc, page = page_of(pdf, n)
    r = page.rect
    # PDF 原本は触らない。メモリ上で線と数字を足して描く
    shape = page.new_shape()
    for i in range(1, 10):
        x = r.x0 + r.width * i / 10
        y = r.y0 + r.height * i / 10
        shape.draw_line((x, r.y0), (x, r.y1))
        shape.draw_line((r.x0, y), (r.x1, y))
    shape.finish(color=(1, 0, 0), width=0.6, dashes='[3 3] 0')
    shape.commit()
    for i in range(1, 10):
        page.insert_text((r.x0 + r.width * i / 10 + 2, r.y0 + 10), f'{i/10:.1f}', fontsize=8, color=(1, 0, 0))
        page.insert_text((r.x0 + 2, r.y0 + r.height * i / 10 - 2), f'{i/10:.1f}', fontsize=8, color=(1, 0, 0))
    pix = page.get_pixmap(dpi=110)
    pix.save(out)
    print(f'{out}  {pix.width}x{pix.height}  （格子は頁の 10% 刻み・左上が 0,0）')


def cmd_clip(pdf, n, box, out):
    doc, page = page_of(pdf, n)
    r = page.rect
    x0, y0, x1, y1 = [float(v) for v in box.split(',')]
    px_dpi = opt('px-dpi')
    if px_dpi:  # 画素（その dpi で描いた画像の座標）→ 割合
        s = 72.0 / float(px_dpi)
        x0, x1 = x0 * s / r.width, x1 * s / r.width
        y0, y1 = y0 * s / r.height, y1 * s / r.height
    if not (0 <= x0 < x1 <= 1 and 0 <= y0 < y1 <= 1):
        sys.exit(f'範囲がおかしい: {x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}（割合 0〜1・左<右・上<下）')
    clip = fitz.Rect(r.x0 + r.width * x0, r.y0 + r.height * y0,
                     r.x0 + r.width * x1, r.y0 + r.height * y1)
    width = int(opt('width', '1200'))
    dpi = max(1, round(width / (clip.width / 72.0)))
    pix = page.get_pixmap(dpi=dpi, clip=clip)
    pix.save(out)
    import os
    kb = os.path.getsize(out) / 1024
    warn = '  ⚠ 100KB を超えた。範囲を絞るか --width を下げる' if kb > 100 else ''
    print(f'{out}  {pix.width}x{pix.height}  {kb:.0f}KB  （頁 {n}・範囲 {x0:.3f},{y0:.3f},{x1:.3f},{y1:.3f}）{warn}')


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) >= 4 and args[0] == 'grid':
        return cmd_grid(args[1], int(args[2]), args[3])
    if len(args) >= 5 and args[0] == 'clip':
        return cmd_clip(args[1], int(args[2]), args[3], args[4])
    sys.exit(__doc__)


if __name__ == '__main__':
    main()
