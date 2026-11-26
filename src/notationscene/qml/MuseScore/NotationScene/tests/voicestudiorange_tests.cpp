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
#include "engraving/dom/segment.h"
#include "engraving/tests/utils/scorerw.h"
#include "voicestudiorange.h"

using namespace mu::engraving;

TEST(VoiceStudioRange, NativeSelectionIncludesEveryMeasureThroughLastOnOneStaff)
{
    MasterScore* score = ScoreRW::readScore(String(u"data/test.mscx"));
    ASSERT_TRUE(score);
    Measure* first = score->firstMeasure();
    ASSERT_TRUE(first);
    Measure* last = first->nextMeasure();
    ASSERT_TRUE(last);

    // This is the same engraving range API used by the Voice Studio controls,
    // so it selects by score time instead of being limited to a displayed row.
    score->select(first, SelectType::RANGE, 0);
    score->select(last, SelectType::RANGE, 0);
    EXPECT_TRUE(score->selection().isRange());
    EXPECT_EQ(score->selection().tickStart(), first->tick());
    EXPECT_EQ(score->selection().tickEnd(), last->endTick());
    EXPECT_EQ(score->selection().staffStart(), size_t(0));
    EXPECT_EQ(score->selection().staffEnd(), size_t(1));
    EXPECT_TRUE(score->selection().canCopy());

    delete score;
}

TEST(VoiceStudioRange, NativeSelectionCanStartInsideMeasureAndEndOnAnotherMeasure)
{
    MasterScore* score = ScoreRW::readScore(String(u"data/test.mscx"));
    ASSERT_TRUE(score);
    Measure* first = score->firstMeasure();
    ASSERT_TRUE(first);
    Measure* second = first->nextMeasure();
    ASSERT_TRUE(second);
    Segment* start = first->first(SegmentType::ChordRest)->next(SegmentType::ChordRest);
    Segment* end = second->first(SegmentType::ChordRest);
    ASSERT_TRUE(start);
    ASSERT_TRUE(end);
    ASSERT_TRUE(start->element(0));
    ASSERT_TRUE(end->element(0));

    score->select(start->element(0), SelectType::RANGE, 0);
    score->select(end->element(0), SelectType::RANGE, 0);
    EXPECT_TRUE(score->selection().isRange());
    EXPECT_EQ(score->selection().tickStart(), start->tick());
    EXPECT_EQ(score->selection().tickEnd(), second->endTick());
    EXPECT_EQ(score->selection().staffStart(), size_t(0));
    EXPECT_EQ(score->selection().staffEnd(), size_t(1));
    EXPECT_TRUE(score->selection().canCopy());

    delete score;
}

TEST(VoiceStudioRange, NativeSelectionStopsAfterClickedNoteWithinMeasure)
{
    MasterScore* score = ScoreRW::readScore(String(u"data/test.mscx"));
    ASSERT_TRUE(score);
    Measure* measure = score->firstMeasure();
    ASSERT_TRUE(measure);
    Segment* first = measure->first(SegmentType::ChordRest);
    ASSERT_TRUE(first);
    Segment* second = first->next(SegmentType::ChordRest);
    ASSERT_TRUE(second);
    Segment* third = second->next(SegmentType::ChordRest);
    ASSERT_TRUE(third);
    ASSERT_TRUE(second->element(0));
    ASSERT_TRUE(third->element(0));

    // The native range API must include the end note, but not the fourth.
    score->select(second->element(0), SelectType::RANGE, 0);
    score->select(third->element(0), SelectType::RANGE, 0);
    EXPECT_TRUE(score->selection().isRange());
    EXPECT_EQ(score->selection().tickStart(), measure->tick() + Fraction(1, 4));
    EXPECT_EQ(score->selection().tickEnd(), measure->tick() + Fraction(3, 4));
    EXPECT_EQ(score->selection().staffStart(), size_t(0));
    EXPECT_EQ(score->selection().staffEnd(), size_t(1));
    EXPECT_TRUE(score->selection().canCopy());

    // Selecting in reverse order should produce the same written span.
    score->deselectAll();
    score->select(third->element(0), SelectType::RANGE, 0);
    score->select(second->element(0), SelectType::RANGE, 0);
    EXPECT_EQ(score->selection().tickStart(), measure->tick() + Fraction(1, 4));
    EXPECT_EQ(score->selection().tickEnd(), measure->tick() + Fraction(3, 4));
    EXPECT_TRUE(score->selection().canCopy());

    delete score;
}

TEST(VoiceStudioRange, EndpointsKeepClickedTrackWhenVoicesShareATick)
{
    MasterScore* score = ScoreRW::readScore(String(u"data/voice_range_multivoice.mscx"));
    ASSERT_TRUE(score);
    Measure* measure = score->firstMeasure();
    ASSERT_TRUE(measure);
    Segment* first = measure->first(SegmentType::ChordRest);
    ASSERT_TRUE(first);
    Segment* sharedTick = first->next(SegmentType::ChordRest);
    ASSERT_TRUE(sharedTick);
    ASSERT_TRUE(first->element(0));
    ASSERT_TRUE(sharedTick->element(0));
    ASSERT_TRUE(sharedTick->element(1));

    const int tick = sharedTick->tick().ticks();
    auto* voice1 = mu::notation::voice_range::chordRestAt(score, { tick, 0 });
    auto* voice2 = mu::notation::voice_range::chordRestAt(score, { tick, 1 });
    ASSERT_EQ(voice1, sharedTick->element(0));
    ASSERT_EQ(voice2, sharedTick->element(1));
    EXPECT_EQ(mu::notation::voice_range::chordRestAt(score, { tick, 2 }), nullptr);

    // Voice 1 has a half note here, but the clicked voice-2 quarter note
    // must end the written span after just one quarter (not after the half).
    auto* start = mu::notation::voice_range::chordRestAt(score, { first->tick().ticks(), 0 });
    ASSERT_TRUE(start);
    score->select(start, SelectType::RANGE, 0);
    score->select(voice2, SelectType::RANGE, 0);
    EXPECT_EQ(score->selection().tickStart(), measure->tick());
    EXPECT_EQ(score->selection().tickEnd(), measure->tick() + Fraction(1, 2));
    EXPECT_EQ(score->selection().staffStart(), size_t(0));
    EXPECT_EQ(score->selection().staffEnd(), size_t(1));

    score->deselectAll();
    score->select(start, SelectType::RANGE, 0);
    score->select(voice1, SelectType::RANGE, 0);
    EXPECT_EQ(score->selection().tickEnd(), measure->tick() + Fraction(3, 4));
    delete score;
}
