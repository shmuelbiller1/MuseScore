# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
"""Cut 0.8 s vowel excerpts from *locally supplied* VocalSet originals.

No network access, downloading, account, or dependency is part of the app.
The original CC BY 4.0 files are documented in vocalset/ATTRIBUTION.md.
Run with: python3 extract-long.py /path/to/source/vocalset
"""
import pathlib
import struct
import sys
import wave

SEGMENTS = {
    'f1': ('soprano-f1-long-a.wav', 5.0),
    'f5': ('alto-f5-long-a.wav', 1.3),
    'm2': ('tenor-m2-long-a.wav', 3.85),
    'm8': ('bass-m8-long-a.wav', 1.4),
}


def main(source_dir):
    output = pathlib.Path(__file__).parent / 'vocalset'
    for singer, (name, start_sec) in SEGMENTS.items():
        with wave.open(str(source_dir / f'{singer}_long_straight_a.wav'), 'rb') as original:
            assert original.getnchannels() == 1 and original.getsampwidth() == 2
            rate = original.getframerate()
            assert rate == 44100
            count = round(rate * 0.8)
            original.setpos(round(rate * start_sec))
            samples = struct.unpack(f'<{count}h', original.readframes(count))
        fade = round(rate * 0.005)
        scale = 0.7 * 32767 / max(1, max(abs(sample) for sample in samples))
        pcm = bytearray()
        for i, sample in enumerate(samples):
            gain = min(1.0, i / fade, (count - 1 - i) / fade)
            pcm.extend(struct.pack('<h', round(sample * gain * scale)))
        with wave.open(str(output / name), 'wb') as excerpt:
            excerpt.setnchannels(1)
            excerpt.setsampwidth(2)
            excerpt.setframerate(rate)
            excerpt.writeframes(pcm)
        print(f'{name}: {start_sec:.2f}–{start_sec + 0.8:.2f}s, 5ms fade, peak 0.7, {rate} Hz')


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('usage: extract-long.py /path/to/source/vocalset')
    main(pathlib.Path(sys.argv[1]))
