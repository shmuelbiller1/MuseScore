/*
 * SPDX-License-Identifier: GPL-3.0-only
 * MuseScore-Studio-CLA-applies
 *
 * MuseScore Studio
 * Music Composition & Notation
 *
 * Copyright (C) 2021 MuseScore Limited and others
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3 as
 * published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */
#include "temposettingsmodel.h"

#include <algorithm>
#include <cmath>

#include "engraving/dom/tempotext.h"
#include "engraving/dom/score.h"
#include "engraving/dom/tempotimeline.h"

#include "dataformatter.h"

#include "translation.h"

using namespace mu::propertiespanel;

TempoSettingsModel::TempoSettingsModel(QObject* parent, const muse::modularity::ContextPtr& iocCtx, IElementRepositoryService* repository,
                                       PropertiesPanelModelType modelType)
    : PropertiesPanelAbstractModel(parent, iocCtx, repository)
{
    Q_ASSERT(modelType == PropertiesPanelModelType::TYPE_TEMPO
             || modelType == PropertiesPanelModelType::TYPE_A_TEMPO
             || modelType == PropertiesPanelModelType::TYPE_TEMPO_PRIMO
             );

    setModelType(modelType);

    switch (modelType) {
    case PropertiesPanelModelType::TYPE_TEMPO:
        setTitle(muse::qtrc("propertiespanel", "Tempo"));
        break;
    case PropertiesPanelModelType::TYPE_A_TEMPO:
        setTitle(muse::qtrc("propertiespanel", "A tempo"));
        break;
    case PropertiesPanelModelType::TYPE_TEMPO_PRIMO:
        setTitle(muse::qtrc("propertiespanel", "Tempo primo"));
        break;
    default:
        break;
    }

    setIcon(muse::ui::IconCode::Code::METRONOME);
    createProperties();
}

void TempoSettingsModel::createProperties()
{
    m_isFollowText
        = buildPropertyItem(mu::engraving::Pid::TEMPO_FOLLOW_TEXT, [this](const mu::engraving::Pid pid, const QVariant& newValue) {
        onPropertyValueChanged(pid, newValue);

        emit requestReloadPropertyItems();
    });

    m_tempo = buildPropertyItem(mu::engraving::Pid::TEMPO);
    m_relativeFactor = buildPropertyItem(mu::engraving::Pid::TEMPO_CHANGE_FACTOR,
                                         [this](const mu::engraving::Pid pid, const QVariant& value) {
        onPropertyValueChanged(pid, value.toDouble() / 100.0);
    });
}

void TempoSettingsModel::requestElements()
{
    m_elementList = m_repository->findElementsByType(mu::engraving::ElementType::TEMPO_TEXT);
    const bool relative = !m_elementList.isEmpty() && std::all_of(m_elementList.cbegin(), m_elementList.cend(),
                                                                  [](const mu::engraving::EngravingItem* item) {
        return mu::engraving::toTempoText(item)->isRelative();
    });
    if (relative != m_relativeTempo) {
        m_relativeTempo = relative;
        emit relativeTempoChanged();
    }
    emit effectiveBpmChanged();
}

void TempoSettingsModel::loadProperties()
{
    // A factor reset or undo can switch the selected marking back to an
    // absolute tempo without changing the selection itself.
    const bool relative = !m_elementList.isEmpty() && std::all_of(m_elementList.cbegin(), m_elementList.cend(),
                                                                  [](const mu::engraving::EngravingItem* item) {
        return mu::engraving::toTempoText(item)->isRelative();
    });
    if (relative != m_relativeTempo) {
        m_relativeTempo = relative;
        emit relativeTempoChanged();
    }
    loadPropertyItem(m_isFollowText);
    loadPropertyItem(m_tempo, formatDoubleFunc);
    loadPropertyItem(m_relativeFactor, [](const QVariant& factor) -> QVariant {
        return muse::DataFormatter::roundDouble(factor.toDouble() * 100.0, 1);
    });
    emit effectiveBpmChanged();
}

QString TempoSettingsModel::effectiveBpm() const
{
    if (m_elementList.size() != 1 || !m_elementList.front()->score()) {
        return QStringLiteral("—");
    }
    const mu::engraving::TempoText* marking = mu::engraving::toTempoText(m_elementList.front());
    return QString::number(marking->score()->multipliedTempo(marking->tick()).toBPM().val, 'f', 1);
}

QString TempoSettingsModel::upcomingTempo() const
{
    if (m_elementList.size() != 1 || !m_elementList.front()->score()) {
        return QStringLiteral("—");
    }
    const mu::engraving::TempoText* marking = mu::engraving::toTempoText(m_elementList.front());
    // The marking's tick is a raw score tick. Keep the timeline in the same
    // coordinate system even when the playback repeat list is expanded.
    const mu::engraving::TempoTimeline& timeline = marking->score()->tempoTimeline(/*expandRepeats*/ false);
    const int tick = marking->tick().ticks();
    const double currentBpm = timeline.tempo(tick).toBPM().val * timeline.tempoMultiplier().val;
    for (const mu::engraving::TempoTimePoint& point : timeline.points()) {
        if (point.utick <= tick) {
            continue;
        }
        const double bpm = point.bps * timeline.tempoMultiplier().val * 60.0;
        if (point.pause > 0.0) {
            return muse::qtrc("propertiespanel", "Pause at tick %1: %2 s (before playback multiplier)")
                   .arg(point.utick).arg(point.pause, 0, 'f', 2);
        }
        if (std::abs(bpm - currentBpm) >= 0.05) {
            // These are sampled playback points; an eased ramp can yield
            // several successive values before its final target.
            return muse::qtrc("propertiespanel", "Next tempo sample at tick %1: %2 BPM")
                   .arg(point.utick).arg(bpm, 0, 'f', 1);
        }
    }
    return muse::qtrc("propertiespanel", "No later tempo or pause in the playback timeline.");
}

PropertyItem* TempoSettingsModel::isFollowText() const
{
    return m_isFollowText;
}

PropertyItem* TempoSettingsModel::tempo() const
{
    return m_tempo;
}
