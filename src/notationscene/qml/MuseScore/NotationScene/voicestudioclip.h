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

#include <QJsonArray>
#include <QJsonObject>

namespace mu::notation::voice {
// A shared source can supply otherwise untagged written notes, but per-note
// placement, duration and pitch edits belong only to the tagged note.
inline QJsonObject clipForWrittenNote(const QJsonArray& clips, int tick, int track, int noteIndex)
{
    for (const auto& item : clips) {
        const QJsonObject candidate = item.toObject();
        if (candidate.value("tick").toInt(-1) == tick && candidate.value("track").toInt(-1) == track
            && candidate.value("noteIndex").toInt(-1) == noteIndex) {
            return candidate;
        }
    }
    QJsonObject fallback;
    if (!clips.isEmpty()) {
        const QJsonObject source = clips.at(0).toObject();
        fallback.insert("sourceStartMs", source.value("sourceStartMs"));
        fallback.insert("sourceEndMs", source.value("sourceEndMs"));
    }
    return fallback;
}

inline bool clipStartsBeforePlayback(int playbackTick, int offsetTicks)
{
    return qint64(playbackTick) + offsetTicks < 0;
}
}
