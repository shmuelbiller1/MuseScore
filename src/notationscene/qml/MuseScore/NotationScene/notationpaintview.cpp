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

#include "notationpaintview.h"

#include "notation/inotationviewstate.h"
#include "notation/inotationelements.h"
#include "project/inotationproject.h"
#include "engraving/dom/page.h"
#include "engraving/dom/system.h"
#include "engraving/dom/measure.h"
#include "engraving/dom/score.h"
#include "engraving/dom/tempotimeline.h"

#include <QFile>
#include <QPainter>
#include <QJsonDocument>
#include <QJsonObject>
#include <QtEndian>
#include <algorithm>
#include <cmath>

using namespace mu;
using namespace muse::draw;
using namespace mu::notation;

NotationPaintView::NotationPaintView(QQuickItem* parent)
    : AbstractNotationPaintView(parent)
{
}

void NotationPaintView::onLoadNotation(INotationPtr notation)
{
    m_isLocalMatrixUpdate = true;
    setMatrix(notation->viewState()->matrix());
    m_isLocalMatrixUpdate = false;

    notation->viewState()->matrixChanged().onReceive(this, [this](const Transform& matrix, NotationPaintView* sender) {
        if (sender != this) {
            m_isLocalMatrixUpdate = true;
            setMatrix(matrix);
            m_isLocalMatrixUpdate = false;
        }
    });

    AbstractNotationPaintView::onLoadNotation(notation);
    m_voiceStudioProject = projectSession()->project();
    if (m_voiceStudioProject) {
        m_voiceStudioProject->needSaveChanged().onNotify(this, [this]() { refreshVoiceStudio(); });
    }
    refreshVoiceStudio();
}

void NotationPaintView::onUnloadNotation(INotationPtr notation)
{
    AbstractNotationPaintView::onUnloadNotation(notation);

    notation->viewState()->matrixChanged().disconnect(this);
    if (m_voiceStudioProject) {
        m_voiceStudioProject->needSaveChanged().disconnect(this);
        m_voiceStudioProject.reset();
    }
    m_voiceStudioCopy = false;
    m_voiceWav.clear();
    m_voicePeaks.clear();
    emit voiceStudioChanged();
}

void NotationPaintView::initZoomAndPosition()
{
    if (notation() && !notation()->viewState()->isMatrixInited()) {
        inputController()->initZoom();
        inputController()->initCanvasPos();
    }
}

void NotationPaintView::onMatrixChanged(const Transform& oldMatrix, const Transform& newMatrix, bool overrideZoomType)
{
    AbstractNotationPaintView::onMatrixChanged(oldMatrix, newMatrix, overrideZoomType);

    if (!m_isLocalMatrixUpdate && notation()) {
        notation()->viewState()->setMatrix(newMatrix, this);

        if (overrideZoomType) {
            notation()->viewState()->setZoomType(ZoomType::Percentage);
        }
    }
}

bool NotationPaintView::voiceStudioCopy() const
{
    return m_voiceStudioCopy;
}

bool NotationPaintView::voiceStudioHasAudio() const
{
    return !m_voicePeaks.isEmpty();
}

void NotationPaintView::refreshVoiceStudio(const QByteArray& sourceOverride)
{
    const auto project = projectSession()->project();
    m_voiceStudioCopy = project && QJsonDocument::fromJson(project->voiceStudioSession()).object().value("version").toInt() == 1;
    m_voiceWav = m_voiceStudioCopy ? (sourceOverride.isEmpty() ? project->voiceStudioSource() : sourceOverride) : QByteArray();
    m_voicePeaks.clear();
    m_voiceFrames = 0;
    m_voiceSampleRate = 0;
    if (!m_voiceWav.isEmpty()) {
        const QByteArray source = m_voiceWav;
        m_voiceWav.clear();
        // Reuse the same validation path for reopened embedded sources.
        if (source.size() <= 64 * 1024 * 1024 && source.mid(0, 4) == "RIFF" && source.mid(8, 4) == "WAVE") {
            int channels = 0;
            int dataOffset = 0;
            int dataSize = 0;
            for (qsizetype offset = 12; offset + 8 <= source.size();) {
                const auto* chunk = reinterpret_cast<const uchar*>(source.constData() + offset);
                const quint32 length = qFromLittleEndian<quint32>(chunk + 4);
                offset += 8;
                if (length > source.size() - offset) {
                    break;
                }
                if (source.mid(offset - 8, 4) == "fmt " && length >= 16
                    && qFromLittleEndian<quint16>(reinterpret_cast<const uchar*>(source.constData() + offset)) == 1
                    && qFromLittleEndian<quint16>(reinterpret_cast<const uchar*>(source.constData() + offset + 14)) == 16) {
                    channels = qFromLittleEndian<quint16>(reinterpret_cast<const uchar*>(source.constData() + offset + 2));
                    m_voiceSampleRate = int(qFromLittleEndian<quint32>(reinterpret_cast<const uchar*>(source.constData() + offset + 4)));
                } else if (source.mid(offset - 8, 4) == "data") {
                    dataOffset = int(offset);
                    dataSize = int(length);
                }
                offset += length + (length & 1);
            }
            if ((channels == 1 || channels == 2) && m_voiceSampleRate >= 8000 && m_voiceSampleRate <= 192000
                && dataSize >= channels * 2) {
                m_voiceFrames = dataSize / (channels * 2);
                const int bins = std::min(m_voiceFrames, 4096);
                m_voicePeaks.fill(0.0f, bins);
                const auto* samples = reinterpret_cast<const uchar*>(source.constData() + dataOffset);
                for (int frame = 0; frame < m_voiceFrames; ++frame) {
                    float peak = 0.0f;
                    for (int ch = 0; ch < channels; ++ch) {
                        const int value = qFromLittleEndian<qint16>(samples + (frame * channels + ch) * 2);
                        peak = std::max(peak, std::abs(float(value) / 32768.0f));
                    }
                    const int bin = int(qint64(frame) * bins / m_voiceFrames);
                    m_voicePeaks[bin] = std::max(m_voicePeaks[bin], peak);
                }
                m_voiceWav = source;
            }
        }
    }
    emit voiceStudioChanged();
    scheduleRedraw();
}

QString NotationPaintView::importVoiceStudioWav(const QUrl& url)
{
    if (!m_voiceStudioCopy || !url.isLocalFile() || !projectSession()->project()) {
        return QStringLiteral("Open a Voice Studio score copy and choose a local WAV file.");
    }
    QFile file(url.toLocalFile());
    if (file.size() > 64 * 1024 * 1024 || !file.open(QIODevice::ReadOnly)) {
        return QStringLiteral("The recording must be a readable WAV smaller than 64 MB.");
    }
    const QByteArray source = file.read(64 * 1024 * 1024 + 1);
    if (source.size() > 64 * 1024 * 1024) {
        return QStringLiteral("The recording must be smaller than 64 MB.");
    }
    // Reject unsupported formats before changing the score's embedded data.
    // The existing session JSON is retained, so score edits and clips survive.
    refreshVoiceStudio(source);
    if (m_voicePeaks.isEmpty()) {
        refreshVoiceStudio();
        return QStringLiteral("Only uncompressed 16-bit mono or stereo RIFF WAV is supported.");
    }
    const auto project = projectSession()->project();
    if (!project->setVoiceStudioData(project->voiceStudioSession(), source)) {
        return QStringLiteral("Could not store the recording inside the score copy.");
    }
    refreshVoiceStudio();
    return {};
}

void NotationPaintView::paint(QPainter* painter)
{
    painter->save();
    AbstractNotationPaintView::paint(painter);
    painter->restore();
    if (m_voiceStudioCopy && !m_voicePeaks.isEmpty()) {
        paintVoiceWaveform(painter);
    }
}

void NotationPaintView::paintVoiceWaveform(QPainter* painter)
{
    if (!notation() || !notation()->elements()->msScore()) {
        return;
    }
    const auto& pages = notation()->elements()->pages();
    if (pages.empty() || m_voiceSampleRate <= 0) {
        return;
    }
    // Unexpanded score time: rests and tempo changes follow the written
    // notation. Repeats still need separate take/playback mapping.
    const auto& timeline = notation()->elements()->msScore()->tempoTimeline(false);
    const double sourceDuration = double(m_voiceFrames) / m_voiceSampleRate;
    painter->save();
    painter->setPen(QPen(QColor(34, 130, 186, 180), 1));
    for (const auto* page : pages) {
        for (const auto* system : page->systems()) {
            if (!system->firstMeasure()) {
                continue;
            }
            const auto bounds = system->canvasBoundingRect();
            const double startTick = system->firstMeasure()->tick().ticks();
            const double endTick = system->endTick().ticks();
            if (endTick <= startTick) {
                continue;
            }
            const double left = bounds.left() + system->leftMargin();
            const double right = bounds.right();
            const double centerY = bounds.bottom() + 14;
            const int columns = std::max(1, std::min(1024, int(right - left)));
            for (int column = 0; column < columns; ++column) {
                const double scoreTick = startTick + (endTick - startTick) * column / columns;
                const double seconds = timeline.utick2utime(int(scoreTick));
                if (seconds < 0 || seconds >= sourceDuration) {
                    continue;
                }
                const int bin = std::clamp(int(seconds / sourceDuration * m_voicePeaks.size()), 0,
                                           int(m_voicePeaks.size()) - 1);
                const double x = left + (right - left) * column / columns;
                const double amplitude = 12 * m_voicePeaks.at(bin);
                const auto top = fromLogical(muse::PointF(x, centerY - amplitude));
                const auto bottom = fromLogical(muse::PointF(x, centerY + amplitude));
                painter->drawLine(QPointF(top.x(), top.y()), QPointF(bottom.x(), bottom.y()));
            }
        }
    }
    painter->restore();
}
