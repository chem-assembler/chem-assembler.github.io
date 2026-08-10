# SchoolLenz QRコード生成（中央にブランドアイコン・誤り訂正H）
# 実行: リポジトリルートで `python tools/gen_qr.py [キャンペーン名]`
# 依存: pip install qrcode pillow（読み取り検査は opencv-python-headless があれば自動で走る）
import os
import sys

import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_H

BRAND = 'brand'
INK = (15, 23, 28)  # ハブの --ink。読み取り安定のため高コントラストを維持する

# ---------------------------------------------------------------------------
# UTM（2026-08-10 追加）
#
# **QR は原理的にリファラを持たない。** 付けないとスキャン流入が丸ごと GA4 の
# `(direct)` に消え、配った QR が効いたのかどうかが永久に分からない。
# 実際、8/10 に `(direct)` が 1,332 セッションまで膨らんだとき、
# **その出所を追えなくなった**（SNS のリンクは全面 UTM 化済みなので、そちらではない）。
#
# 文字数が増えるとマス目が細かくなる（素の URL 27字なら 33×33、UTM 込み 78字だと 49×49）。
# **紙に小さく刷るなら効いてくる**が、この QR は PC 画面に出して読ませる用途なので実害はない
# （2026-08-10 に確認）。**紙に刷る用途が出てきたら、そのとき実寸で試すこと。**
#
# utm_campaign は**出す場面ごとに**変える。コマンドライン引数で渡せる:
#     python tools/gen_qr.py setsumeikai
# ---------------------------------------------------------------------------
CAMPAIGN = sys.argv[1] if len(sys.argv) > 1 else 'v1'
UTM = '?utm_source=qr&utm_medium=screen&utm_campaign=' + CAMPAIGN

TARGETS = [
    ('qr-chem.png', 'https://chem.schoollenz.com/' + UTM),
    ('qr-portal.png', 'https://schoollenz.com/' + UTM),
]

icon = Image.open(os.path.join(BRAND, 'icon-1024.png')).convert('RGBA')


def verify(path, expected):
    """刷る前に、生成した画像が本当にその URL として読めるかを機械で確かめる。
    UTM で桁数が増えたぶんマス目が細かくなるので、目視では判断できない。"""
    try:
        import cv2
        import numpy as np
    except ImportError:
        return '（opencv 未導入のため読み取り検査を飛ばした）'
    data = np.fromfile(path, dtype=np.uint8)          # 日本語パス対策で imread を使わない
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    decoded, _, _ = cv2.QRCodeDetector().detectAndDecode(img)
    if decoded == expected:
        return '読み取りOK'
    return 'ERROR: 読み取れない（decoded=%r）' % (decoded,)


failed = False
for fname, url in TARGETS:
    qr = qrcode.QRCode(error_correction=ERROR_CORRECT_H, box_size=24, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=INK, back_color='white').convert('RGBA')

    # 中央にアイコンを約20%サイズで重ねる（白枠パッド付き。EC=H なので読み取り可）
    w = img.size[0]
    isize = int(w * 0.20)
    pad = int(isize * 0.08)
    frame = Image.new('RGBA', (isize + pad * 2, isize + pad * 2), 'white')
    ic = icon.resize((isize, isize), Image.LANCZOS)
    frame.paste(ic, (pad, pad), ic)
    img.paste(frame, ((w - frame.size[0]) // 2, (w - frame.size[1]) // 2))

    out = os.path.join(BRAND, fname)
    img.convert('RGB').save(out)
    note = verify(out, url)
    if note.startswith('ERROR'):
        failed = True
    print('%s  %dx%d マス %d  %s' % (fname, img.size[0], img.size[1], qr.modules_count, note))
    print('    -> %s' % url)

if failed:
    sys.exit(1)
