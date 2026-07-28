# V1 ずんだもん版ナレーション生成（VOICEVOX ローカルAPI）
# 台本: video-scripts/V1.md §2b。表示用台本と違い、読み間違えやすい語をカナに開いてある
import json
import os
import urllib.parse
import urllib.request
import wave

BASE = 'http://127.0.0.1:50021'
SPEAKER = 3  # ずんだもん ノーマル
OUT = r'C:\Users\maequ\マイドライブ\Antigravity\OrganicChemistryPuzzle\video-scripts\audio\v1-zundamon'

LINES = [
    ('01-hook',    '化学の構造式、ノートに書く感覚で描けるアプリを作ったのだ。'),
    ('02-place',   'マスをタップすると炭素。となりに置くと、自動でつながるのだ。'),
    ('03-double',  '結合をもう一回タップすれば、二重結合。'),
    ('04-phenol',  'ベンゼン環はワンタップ。オーエイチを付けると、名前も教えてくれるのだ。フェノールなのだ。'),
    ('05-undo',    '間違えても、ワンタップで戻せる。消しゴムはいらないのだ。'),
    ('06-close',   '紙より速く、紙より確かめられる。構造式の練習に、ぜひ使ってほしいのだ。'),
    ('07-cta',     '無料、インストール不要。リンクはプロフィールなのだ。'),
]

os.makedirs(OUT, exist_ok=True)
total = 0.0
report = []
frames = []
params = None

for name, text in LINES:
    q = urllib.request.urlopen(urllib.request.Request(
        f'{BASE}/audio_query?speaker={SPEAKER}&text=' + urllib.parse.quote(text),
        method='POST'), timeout=30).read()
    wav = urllib.request.urlopen(urllib.request.Request(
        f'{BASE}/synthesis?speaker={SPEAKER}', data=q,
        headers={'Content-Type': 'application/json'}, method='POST'), timeout=60).read()
    path = os.path.join(OUT, f'{name}.wav')
    with open(path, 'wb') as f:
        f.write(wav)
    with wave.open(path, 'rb') as w:
        dur = w.getnframes() / w.getframerate()
        params = w.getparams()
        frames.append(w.readframes(w.getnframes()))
    total += dur
    report.append(f'{name}: {dur:.1f}s  {text[:18]}…')

# 通し確認用に連結版も作る（各行間に0.6sの無音）
gap = b'\x00' * int(0.6 * params.framerate) * params.sampwidth * params.nchannels
with wave.open(os.path.join(OUT, 'v1-zundamon-full.wav'), 'wb') as w:
    w.setparams(params)
    for i, fr in enumerate(frames):
        if i:
            w.writeframes(gap)
        w.writeframes(fr)

print('\n'.join(report))
print(f'TOTAL speech: {total:.1f}s (+gaps 0.6s x6 = {total + 3.6:.1f}s full)')
