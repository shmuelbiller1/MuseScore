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

#include "engraving/dom/chordrest.h"
#include "engraving/dom/score.h"
#include "engraving/dom/segment.h"

namespace mu::notation::voice_range {
// A staff and tick are not enough to identify a note on a multi-voice staff.
// Store the track as well so that selection ends after the clicked chord/rest.
struct Endpoint {
    int tick = -1;
    int track = -1;
};

inline engraving::ChordRest* chordRestAt(engraving::Score* score, Endpoint endpoint)
{
    if (!score || endpoint.tick < 0 || endpoint.track < 0 || endpoint.track >= int(score->ntracks())) {
        return nullptr;
    }
    auto* segment = score->tick2segment(engraving::Fraction::fromTicks(endpoint.tick), true,
                                        engraving::SegmentType::ChordRest, false);
    if (!segment || segment->tick().ticks() != endpoint.tick) {
        return nullptr;
    }
    auto* element = segment->element(endpoint.track);
    return element && element->isChordRest() ? engraving::toChordRest(element) : nullptr;
}
}
