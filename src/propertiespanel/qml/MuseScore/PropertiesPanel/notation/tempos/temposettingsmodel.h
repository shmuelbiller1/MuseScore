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
#pragma once

#include <qqmlintegration.h>

#include "propertiespanelabstractmodel.h"

namespace mu::propertiespanel {
class TempoSettingsModel : public PropertiesPanelAbstractModel
{
    Q_OBJECT
    QML_ELEMENT;
    QML_UNCREATABLE("Not creatable from QML")

    Q_PROPERTY(mu::propertiespanel::PropertyItem * followText READ isFollowText CONSTANT)
    Q_PROPERTY(mu::propertiespanel::PropertyItem * tempo READ tempo CONSTANT)
    Q_PROPERTY(mu::propertiespanel::PropertyItem * relativeFactor READ relativeFactor CONSTANT)
    Q_PROPERTY(bool relativeTempo READ relativeTempo NOTIFY relativeTempoChanged)
    Q_PROPERTY(QString effectiveBpm READ effectiveBpm NOTIFY effectiveBpmChanged)
    Q_PROPERTY(QString upcomingTempo READ upcomingTempo NOTIFY effectiveBpmChanged)

public:
    explicit TempoSettingsModel(QObject* parent, const muse::modularity::ContextPtr& iocCtx, IElementRepositoryService* repository,
                                PropertiesPanelModelType modelType);

    void createProperties() override;
    void requestElements() override;
    void loadProperties() override;

    PropertyItem* isFollowText() const;
    PropertyItem* tempo() const;
    PropertyItem* relativeFactor() const { return m_relativeFactor; }
    bool relativeTempo() const { return m_relativeTempo; }
    QString effectiveBpm() const;
    QString upcomingTempo() const;

signals:
    void relativeTempoChanged();
    void effectiveBpmChanged();

private:
    PropertyItem* m_isFollowText = nullptr;
    PropertyItem* m_tempo = nullptr;
    PropertyItem* m_relativeFactor = nullptr;
    bool m_relativeTempo = false;
};
}
