/*
 * SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 *
 * MuseScore Studio
 * Music Composition & Notation
 *
 * Copyright (C) 2026 MuseScore Limited and others
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 */

#pragma once

#ifdef MUE_VOICE_STUDIO_MP3
#include <algorithm>
#include <cmath>
#include <memory>
#include <vector>

#include <QByteArray>

#include <lame/lame.h>

namespace mu::notation::voice {
// Encode the *processed* mix, not MuseScore's regular instrumental playback.
// Return an empty array on any encoder failure; the caller must not commit it.
inline QByteArray encodeProcessedMp3(const std::vector<float>& samples, int rate)
{
    if (samples.empty() || rate < 8000 || rate > 48000 || samples.size() > size_t(rate) * 240) {
        return {};
    }
    const int bitrate = rate < 16000 ? 64 : rate < 32000 ? 96 : 128;
    std::unique_ptr<lame_global_flags, decltype(& lame_close)> encoder(lame_init(), lame_close);
    if (!encoder || lame_set_num_channels(encoder.get(), 2) < 0 || lame_set_in_samplerate(encoder.get(), rate) < 0
        || lame_set_brate(encoder.get(), bitrate) < 0 || lame_init_params(encoder.get()) < 0) {
        return {};
    }
    float peak = 0;
    for (float sample : samples) {
        peak = std::max(peak, std::abs(sample));
    }
    const float gain = peak > 0.97f ? 0.97f / peak : 1.0f;
    constexpr int chunk = 4096;
    std::vector<float> stereo(chunk * 2);
    std::vector<unsigned char> encoded(7200 + chunk * 2);
    QByteArray result;
    for (size_t offset = 0; offset < samples.size(); offset += chunk) {
        const int count = int(std::min(size_t(chunk), samples.size() - offset));
        for (int i = 0; i < count; ++i) {
            const float value = std::clamp(samples[offset + i] * gain, -1.0f, 1.0f);
            stereo[2 * i] = value;
            stereo[2 * i + 1] = value;
        }
        const int bytes = lame_encode_buffer_interleaved_ieee_float(encoder.get(), stereo.data(), count,
                                                                    encoded.data(), int(encoded.size()));
        if (bytes < 0) {
            return {};
        }
        result.append(reinterpret_cast<const char*>(encoded.data()), bytes);
    }
    const int finalBytes = lame_encode_flush(encoder.get(), encoded.data(), int(encoded.size()));
    if (finalBytes < 0) {
        return {};
    }
    result.append(reinterpret_cast<const char*>(encoded.data()), finalBytes);
    return result;
}
}
#endif
