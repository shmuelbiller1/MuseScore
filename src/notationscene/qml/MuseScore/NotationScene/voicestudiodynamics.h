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

#include <algorithm>
#include <cmath>
#include <iterator>
#include <map>

#include "engraving/dom/dynamic.h"
#include "engraving/dom/measure.h"
#include "engraving/dom/score.h"
#include "engraving/dom/segment.h"

namespace mu::notation::voice {
using StaffDynamics = std::map<int, std::map<int, float> >;

inline float gainForVelocity(int velocity)
{
    // mf (velocity 80) is the reference. Keep a useful but bounded difference
    // between soft and loud without crushing the recording or clipping.
    return std::clamp(float(std::pow(2.0, (velocity - 80) / 64.0)), 0.2f, 1.8f);
}

inline bool sustainedDynamic(engraving::DynamicType type)
{
    using engraving::DynamicType;
    switch (type) {
    case DynamicType::PPPPPP:
    case DynamicType::PPPPP:
    case DynamicType::PPPP:
    case DynamicType::PPP:
    case DynamicType::PP:
    case DynamicType::P:
    case DynamicType::MP:
    case DynamicType::MF:
    case DynamicType::F:
    case DynamicType::FF:
    case DynamicType::FFF:
    case DynamicType::FFFF:
    case DynamicType::FFFFF:
    case DynamicType::FFFFFF:
        return true;
    default:
        // sfz, fp, etc. are transient accents, not persistent levels.
        return false;
    }
}

inline StaffDynamics collectWrittenDynamics(const engraving::Score* score)
{
    StaffDynamics result;
    if (!score) {
        return result;
    }
    for (const auto* measure = score->firstMeasure(); measure; measure = measure->nextMeasure()) {
        for (const auto* segment = measure->first(); segment; segment = segment->next()) {
            for (const auto* item : segment->annotations()) {
                if (!item->isDynamic() || item->staffIdx() >= score->nstaves()) {
                    continue;
                }
                const auto* dynamic = engraving::toDynamic(item);
                if (!dynamic->playDynamic() || !sustainedDynamic(dynamic->dynamicType())) {
                    continue;
                }
                result[int(item->staffIdx())][segment->tick().ticks()] = gainForVelocity(dynamic->velocity());
            }
        }
    }
    return result;
}

inline float writtenGainAt(const StaffDynamics& dynamics, int staff, int tick)
{
    const auto found = dynamics.find(staff);
    if (found == dynamics.end()) {
        return 1.0f;
    }
    const auto it = found->second.upper_bound(tick);
    return it == found->second.begin() ? 1.0f : std::prev(it)->second;
}
}
