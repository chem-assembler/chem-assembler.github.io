# SchoolLenz QRコード生成（中央にブランドアイコン・誤り訂正H）
# 実行: リポジトリルートで `python tools/gen_qr.py`
# 依存: pip install qrcode pillow（検証は opencv-python-headless の QRCodeDetector）
import os

import qrcode
from PIL import Image
from qrcode.constants import ERROR_CORRECT_H

BRAND = 'brand'
INK = (15, 23, 28)  # ハブの --ink。読み取り安定のため高コントラストを維持する

TARGETS = [
    ('qr-chem.png', 'https://chem.schoollenz.com'),
    ('qr-portal.png', 'https://schoollenz.com'),
]

icon = Image.open(os.path.join(BRAND, 'icon-1024.png')).convert('RGBA')

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

    img.convert('RGB').save(os.path.join(BRAND, fname))
    print(fname, img.size, '->', url)
