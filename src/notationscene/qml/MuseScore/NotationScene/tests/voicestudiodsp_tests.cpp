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
#include <gtest/gtest.h>

#include <cmath>
#include <vector>

#include "../voicestudiodsp.h"

using namespace mu::notation::voice;

TEST(VoiceStudioDsp, PreservesRequestedPitchAndOutputDuration)
{
    const int rate = 16000;
    std::vector<float> source(rate);
    for (int i = 0; i < rate; ++i) {
        source[i] = float(0.35 * std::sin(2 * 3.141592653589793 * 220 * i / rate));
    }
    EXPECT_NEAR(estimatePitch(source, rate, 1000, 6000), 220, 5);
    const auto bass = synthesize(source, rate, 1000, 6000, 196, rate);
    EXPECT_EQ(bass.size(), size_t(rate));
    EXPECT_NEAR(estimatePitch(bass, rate, rate / 2, rate * 3 / 4), 196, 6);
    const auto longer = synthesize(source, rate, 1000, 6000, 196, rate * 2);
    EXPECT_EQ(longer.size(), size_t(rate * 2));
    EXPECT_NEAR(estimatePitch(longer, rate, rate, rate + rate / 4), 196, 6);
}

TEST(VoiceStudioDsp, OneSourceCanRenderBassAloneOrFourIndependentWrittenTargets)
{
    const int rate = 16000;
    std::vector<float> take(rate);
    for (int i = 0; i < rate; ++i) {
        take[i] = float(0.3 * std::sin(2 * 3.141592653589793 * 220 * i / rate));
    }
    const auto bass = synthesize(take, rate, 1000, 6000, 196, rate / 2);
    EXPECT_NEAR(estimatePitch(bass, rate, rate / 4, rate / 4 + 2000), 196, 6);
    const auto plan = prepare(take, rate, 1000, 6000);
    for (double writtenHz : { 196.0, 246.94, 293.66, 392.0 }) {
        const auto voice = synthesize(take, rate, plan, writtenHz, rate / 2);
        EXPECT_NEAR(estimatePitch(voice, rate, rate / 4, rate / 4 + 2000), writtenHz, 10);
    }
}

TEST(VoiceStudioDsp, RejectsSilenceAndInvalidRanges)
{
    std::vector<float> silent(16000, 0);
    EXPECT_THROW(estimatePitch(silent, 16000, 0, 6000), std::runtime_error);
    EXPECT_THROW(synthesize(silent, 16000, 0, 6000, 196, 16000), std::runtime_error);
    EXPECT_THROW(synthesize(silent, 16000, -1, 6000, 196, 16000), std::runtime_error);
    EXPECT_THROW(synthesize(silent, 16000, 0, 6000, 196, 0), std::runtime_error);
    EXPECT_THROW(synthesize(silent, 16000, 0, 6000, 2000, 16000), std::runtime_error);
}
