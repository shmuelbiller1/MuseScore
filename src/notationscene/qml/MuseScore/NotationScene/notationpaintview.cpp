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
#include "notation/inotationinteraction.h"
#include "notation/inotationselection.h"
#include "project/inotationproject.h"
#include "engraving/dom/page.h"
#include "engraving/dom/system.h"
#include "engraving/dom/measure.h"
#include "engraving/dom/measurebase.h"
#include "engraving/dom/segment.h"
#include "engraving/dom/note.h"
#include "engraving/dom/chord.h"
#include "engraving/dom/score.h"
#include "engraving/dom/tempotimeline.h"

#include <QFile>
#include <QPainter>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QtEndian>
#include <algorithm>
#include <cmath>
#include <utility>
#include <vector>

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
    m_voiceStudioProject = studioProjectSession()->project();
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

int NotationPaintView::voiceStudioAudioLengthMs() const
{
    return m_voiceSampleRate > 0 ? int(qint64(m_voiceFrames) * 1000 / m_voiceSampleRate) : 0;
}

QString NotationPaintView::tagVoiceNote(int sourceStartMs, int sourceEndMs)
{
    if (!voiceStudioHasAudio() || sourceStartMs < 0 || sourceEndMs <= sourceStartMs
        || sourceEndMs > voiceStudioAudioLengthMs() || !notation() || !studioProjectSession()->project()) {
        return QStringLiteral("Select a valid source interval in the imported recording.");
    }
    const auto selection = notation()->interaction()->selection();
    const auto notes = selection->notes();
    if (notes.size() != 1) {
        return QStringLiteral("Select exactly one written note before tagging this slice.");
    }
    const auto* note = notes.front();
    const auto* chord = note->chord();
    if (!chord) {
        return QStringLiteral("Select a pitched note, not a rest.");
    }
    const auto& chordNotes = chord->notes();
    const auto found = std::find(chordNotes.begin(), chordNotes.end(), note);
    if (found == chordNotes.end()) {
        return QStringLiteral("The selected note is no longer in the score.");
    }
    const auto project = studioProjectSession()->project();
    QJsonObject root = QJsonDocument::fromJson(project->voiceStudioSession()).object();
    if (root.value("version").toInt() != 1) {
        return QStringLiteral("Unsupported Voice Studio session version.");
    }
    QJsonArray clips = root.value("clips").toArray();
    const int tick = chord->tick().ticks();
    const int track = int(note->track());
    const int noteIndex = int(std::distance(chordNotes.begin(), found));
    for (int i = clips.size() - 1; i >= 0; --i) {
        const QJsonObject existing = clips.at(i).toObject();
        if (existing.value("tick").toInt(-1) == tick && existing.value("track").toInt(-1) == track
            && existing.value("noteIndex").toInt(-1) == noteIndex) {
            clips.removeAt(i);
        }
    }
    QJsonObject clip;
    clip.insert("tick", tick);
    clip.insert("track", track);
    clip.insert("noteIndex", noteIndex);
    clip.insert("writtenPitch", note->pitch());
    clip.insert("sourceStartMs", sourceStartMs);
    clip.insert("sourceEndMs", sourceEndMs);
    clip.insert("scoreOffsetTicks", 0);
    clip.insert("stretch", 1.0);
    clips.append(clip);
    root.insert("clips", clips);
    if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
        return QStringLiteral("Could not save this note tag in the score copy.");
    }
    scheduleRedraw();
    return {};
}

void NotationPaintView::refreshVoiceStudio(const QByteArray& sourceOverride)
{
    const auto project = studioProjectSession()->project();
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
    if (!m_voiceStudioCopy || !url.isLocalFile() || !studioProjectSession()->project()) {
        return QStringLiteral("Open a Voice Studio score copy and choose a local WAV file.");
    }
    const auto project = studioProjectSession()->project();
    if (!QJsonDocument::fromJson(project->voiceStudioSession()).object().value("clips").toArray().isEmpty()) {
        return QStringLiteral("This score already has note tags; replacing the source would invalidate them.");
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
    const QJsonArray clips
        = QJsonDocument::fromJson(studioProjectSession()->project()->voiceStudioSession()).object().value("clips").toArray();
    painter->save();
    painter->setPen(QPen(QColor(34, 130, 186, 180), 1));
    for (const auto* page : pages) {
        for (const auto* system : page->systems()) {
            if (!system->firstMeasure()) {
                continue;
            }
            const auto bounds = system->canvasBoundingRect();
            const auto viewBounds = fromLogical(muse::RectF(bounds.left(), bounds.top(), bounds.width(), bounds.height() + 28));
            if (!viewBounds.toQRectF().intersects(QRectF(0, 0, width(), height()))) {
                continue;
            }
            const double startTick = system->firstMeasure()->tick().ticks();
            const double endTick = system->endTick().ticks();
            if (endTick <= startTick) {
                continue;
            }
            const double left = bounds.left() + system->leftMargin();
            const double right = bounds.right();
            const double centerY = bounds.bottom() + 14;
            // Engraving spacing is not linear in ticks. Use the *actual*
            // chord/rest segment coordinates, rebuilt on each score relayout.
            std::vector<std::pair<double, double> > anchors { { left, startTick } };
            for (const auto* measureBase : system->measures()) {
                if (!measureBase->isMeasure()) {
                    continue;
                }
                const auto* measure = engraving::toMeasure(measureBase);
                for (const auto* segment = measure->first(engraving::SegmentType::ChordRest);
                     segment; segment = segment->next(engraving::SegmentType::ChordRest)) {
                    const double x = segment->canvasX();
                    if (x > left && x < right) {
                        anchors.emplace_back(x, segment->tick().ticks());
                    }
                }
            }
            anchors.emplace_back(right, endTick);
            std::sort(anchors.begin(), anchors.end());
            const int columns = std::max(1, std::min(1024, int(right - left)));
            for (int column = 0; column < columns; ++column) {
                const double x = left + (right - left) * column / columns;
                const auto later = std::lower_bound(anchors.begin(), anchors.end(), x,
                                                    [](const auto& anchor, double position) { return anchor.first < position; });
                if (later == anchors.begin() || later == anchors.end()) {
                    continue;
                }
                const auto& earlier = *std::prev(later);
                const double width = later->first - earlier.first;
                const double scoreTick = width > 0 ? earlier.second + (later->second - earlier.second)
                                         * (x - earlier.first) / width : earlier.second;
                const double seconds = timeline.utick2utime(int(scoreTick));
                if (seconds < 0 || seconds >= sourceDuration) {
                    continue;
                }
                const int bin = std::clamp(int(seconds / sourceDuration * m_voicePeaks.size()), 0,
                                           int(m_voicePeaks.size()) - 1);
                const double amplitude = 12 * m_voicePeaks.at(bin);
                const auto top = fromLogical(muse::PointF(x, centerY - amplitude));
                const auto bottom = fromLogical(muse::PointF(x, centerY + amplitude));
                painter->drawLine(QPointF(top.x(), top.y()), QPointF(bottom.x(), bottom.y()));
            }
            for (const auto& value : clips) {
                const int tick = value.toObject().value("tick").toInt(-1);
                if (tick < startTick || tick >= endTick) {
                    continue;
                }
                double x = left;
                for (size_t i = 1; i < anchors.size(); ++i) {
                    if (tick > anchors[i].second && i + 1 < anchors.size()) {
                        continue;
                    }
                    const double dt = anchors[i].second - anchors[i - 1].second;
                    x = dt > 0 ? anchors[i - 1].first + (anchors[i].first - anchors[i - 1].first)
                        * (tick - anchors[i - 1].second) / dt : anchors[i].first;
                    break;
                }
                const auto top = fromLogical(muse::PointF(x, centerY - 13));
                const auto bottom = fromLogical(muse::PointF(x, centerY + 13));
                painter->setPen(QPen(QColor(235, 100, 55), 2));
                painter->drawLine(QPointF(top.x(), top.y()), QPointF(bottom.x(), bottom.y()));
                painter->setPen(QPen(QColor(34, 130, 186, 180), 1));
            }
        }
    }
    painter->restore();
}
