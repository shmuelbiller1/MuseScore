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

#include "engraving/dom/masterscore.h"
#include "engraving/dom/measure.h"
#include "engraving/tests/utils/scorerw.h"
#include "../voicestudiodynamics.h"

using namespace mu::engraving;
using namespace mu::notation::voice;

TEST(VoiceStudioDynamics, WrittenPianoForteAndMezzoFortePersistUntilReplaced)
{
    MasterScore* score = ScoreRW::readScore(String(u"data/voice_dynamics.mscx"));
    ASSERT_TRUE(score);
    Measure* first = score->firstMeasure();
    ASSERT_TRUE(first);
    Measure* second = first->nextMeasure();
    ASSERT_TRUE(second);

    const auto dynamics = collectWrittenDynamics(score);
    const int tick = first->tick().ticks();
    const int next = second->tick().ticks();
    EXPECT_LT(writtenGainAt(dynamics, 0, tick), 1.0f); // pp
    EXPECT_FLOAT_EQ(writtenGainAt(dynamics, 0, tick), writtenGainAt(dynamics, 0, tick + 480));
    EXPECT_GT(writtenGainAt(dynamics, 0, tick + 960), 1.0f); // f
    EXPECT_FLOAT_EQ(writtenGainAt(dynamics, 0, tick + 960), writtenGainAt(dynamics, 0, next - 1));
    EXPECT_FLOAT_EQ(writtenGainAt(dynamics, 0, next), 1.0f); // mf restores reference level
    EXPECT_FLOAT_EQ(writtenGainAt(dynamics, 1, next), 1.0f); // other staves are independent
    delete score;
}

TEST(VoiceStudioDynamics, GainHasBoundedReferenceAndNoMarksDefaultToNormal)
{
    EXPECT_FLOAT_EQ(gainForVelocity(80), 1.0f);
    EXPECT_LT(gainForVelocity(49), 1.0f);
    EXPECT_GT(gainForVelocity(96), 1.0f);
    EXPECT_LE(gainForVelocity(127), 1.8f);
    EXPECT_FLOAT_EQ(writtenGainAt({}, 0, 0), 1.0f);
}
