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
#include <QUrl>
#include <QByteArray>

#include "abstractnotationpaintview.h"
#include "project/inotationproject_fwd.h"

namespace mu::notation {
class NotationPaintView : public AbstractNotationPaintView
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool voiceStudioCopy READ voiceStudioCopy NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceStudioHasAudio READ voiceStudioHasAudio NOTIFY voiceStudioChanged)

public:
    explicit NotationPaintView(QQuickItem* parent = nullptr);
    bool voiceStudioCopy() const;
    bool voiceStudioHasAudio() const;
    Q_INVOKABLE QString importVoiceStudioWav(const QUrl& url);

signals:
    void voiceStudioChanged();

private:
    void paint(QPainter* painter) override;
    void paintVoiceWaveform(QPainter* painter);
    void refreshVoiceStudio(const QByteArray& sourceOverride = {});

    void onLoadNotation(INotationPtr notation) override;
    void onUnloadNotation(INotationPtr notation) override;

    void initZoomAndPosition() override;

    void onMatrixChanged(const muse::draw::Transform& oldMatrix, const muse::draw::Transform& newMatrix,
                         bool overrideZoomType = true) override;

    bool m_isLocalMatrixUpdate = false;
    QByteArray m_voiceWav;
    QVector<float> m_voicePeaks;
    int m_voiceFrames = 0;
    bool m_voiceStudioCopy = false;
    project::INotationProjectPtr m_voiceStudioProject;
};
}
