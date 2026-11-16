#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
# MuseScore-Studio-CLA-applies
"""Fail if an offline-rendered WAV has no real non-silent PCM/float samples."""

import struct
import sys
from pathlib import Path


def verify(path: Path) -> str:
    data = path.read_bytes()
    if data[:4] != b"RIFF" or data[8:12] != b"WAVE":
        raise ValueError("not a RIFF/WAVE file")
    fmt = audio = None
    offset = 12
    while offset + 8 <= len(data):
        tag = data[offset:offset + 4]
        length = struct.unpack_from("<I", data, offset + 4)[0]
        start = offset + 8
        if start + length > len(data):
            raise ValueError("truncated WAV chunk")
        if tag == b"fmt ":
            fmt = data[start:start + length]
        elif tag == b"data":
            audio = data[start:start + length]
        offset = start + length + (length & 1)
    if fmt is None or audio is None or len(fmt) < 16 or len(audio) < 4096:
        raise ValueError("missing fmt chunk or substantial audio data")
    format_id, channels, rate, _, block_align, bits = struct.unpack_from("<HHIIHH", fmt)
    if format_id == 0xFFFE and len(fmt) >= 40:  # WAVE_FORMAT_EXTENSIBLE
        format_id = struct.unpack_from("<H", fmt, 24)[0]
    if channels == 0 or rate == 0 or block_align == 0:
        raise ValueError("invalid WAV format")
    sample_size = (bits + 7) // 8
    if sample_size == 0 or block_align < channels * sample_size:
        raise ValueError("invalid sample alignment")

    # Compare normalized amplitudes to -80 dBFS. A full-length silent WAV must
    # not be mistaken for proof that the bundled soundfont rendered notes.
    peak = 0.0
    limit = min(len(audio), rate * block_align * 12)
    for pos in range(0, limit - sample_size + 1, sample_size):
        raw = audio[pos:pos + sample_size]
        if format_id == 1 and bits in (8, 16, 24, 32):
            value = (raw[0] - 128) / 128 if bits == 8 else int.from_bytes(raw, "little", signed=True) / (1 << (bits - 1))
        elif format_id == 3 and bits in (32, 64):
            value = struct.unpack("<f" if bits == 32 else "<d", raw)[0]
        else:
            raise ValueError(f"unsupported WAV sample format: format={format_id}, bits={bits}")
        peak = max(peak, abs(value))
        if peak > 0.0001:
            break
    if peak <= 0.0001:
        raise ValueError("WAV contains only silence in its first 12 seconds")
    return f"{channels} channels, {rate} Hz, peak > -80 dBFS, {len(audio)} data bytes"


if __name__ == "__main__":
    try:
        print(verify(Path(sys.argv[1])))
    except (OSError, ValueError, IndexError) as error:
        sys.exit(f"Offline audio verification failed: {error}")
