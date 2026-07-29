# ナレーション音声を作る（VOICEVOX ローカルAPI）
# 使い方: python video-scripts/narrate.py video-scripts/narration/V2.json
#
# 入力JSONの形: [{"name": "01-hook", "text": "読み上げる文"}, ...]
# 出力: video-scripts/audio/<入力名>/ に行ごとのwav＋通し版 full.wav
#
# **読み仮名を必ず表示する**。化学用語は誤読されやすく（実例:「環」→たまき、
# 文頭の「紙より」→こより）、音を聞く前にここで気づけるようにしてある。
import json
import os
import sys
import urllib.parse
import urllib.request
import wave

BASE = 'http://127.0.0.1:50021'
SPEAKER = int(os.environ.get('VOICEVOX_SPEAKER', '3'))  # 既定: ずんだもん ノーマル
GAP = 0.6  # 行間の無音（秒）

src = sys.argv[1]
lines = json.load(open(src, encoding='utf-8'))
stem = os.path.splitext(os.path.basename(src))[0]
out = os.path.join('video-scripts', 'audio', stem)
os.makedirs(out, exist_ok=True)

total, frames, params = 0.0, [], None
for item in lines:
    name, text = item['name'], item['text']
    q = urllib.request.urlopen(urllib.request.Request(
        f'{BASE}/audio_query?speaker={SPEAKER}&text=' + urllib.parse.quote(text),
        method='POST'), timeout=30).read()
    kana = json.loads(q).get('kana', '')
    wav = urllib.request.urlopen(urllib.request.Request(
        f'{BASE}/synthesis?speaker={SPEAKER}', data=q,
        headers={'Content-Type': 'application/json'}, method='POST'), timeout=60).read()
    path = os.path.join(out, f'{name}.wav')
    with open(path, 'wb') as f:
        f.write(wav)
    with wave.open(path, 'rb') as w:
        total += w.getnframes() / w.getframerate()
        params = w.getparams()
        frames.append(w.readframes(w.getnframes()))
    print(f'{name}: {w.getnframes() / w.getframerate():.1f}s  {kana}')

gap = b'\x00' * int(GAP * params.framerate) * params.sampwidth * params.nchannels
full = os.path.join(out, 'full.wav')
with wave.open(full, 'wb') as w:
    w.setparams(params)
    for i, fr in enumerate(frames):
        if i:
            w.writeframes(gap)
        w.writeframes(fr)

print(f'TOTAL {total:.1f}s (+間 {GAP}s x{len(frames) - 1} = {total + GAP * (len(frames) - 1):.1f}s) -> {full}')
