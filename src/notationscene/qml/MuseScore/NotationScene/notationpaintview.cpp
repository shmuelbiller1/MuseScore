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
#include "engraving/dom/tie.h"
#include "engraving/dom/score.h"
#include "engraving/dom/repeatlist.h"
#include "engraving/dom/tempotimeline.h"
#include "voicestudioclip.h"
#include "voicestudiodsp.h"

#include <QFile>
#include <QFileInfo>
#include <QSaveFile>
#include <QSet>
#include <QHash>
#include <QDateTime>
#include <QTimer>

#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <mmsystem.h>
#endif
#include <QPainter>
#include <QJsonDocument>
#include <QJsonArray>
#include <QJsonObject>
#include <QStringList>
#include <QtEndian>
#include <algorithm>
#include <cmath>
#include <cstring>
#include <utility>
#include <vector>
#include <map>

using namespace mu;
using namespace muse::draw;
using namespace mu::notation;

struct NotationPaintView::NativeVoiceIO
{
#ifdef Q_OS_WIN
    HWAVEIN input = nullptr;
    WAVEHDR captureHeader {};
    QByteArray capture;
    HWAVEOUT output = nullptr;
    WAVEHDR playbackHeader {};
    QByteArray playing;
    qint64 startedMs = 0;
    QTimer timer;
#endif
};

NotationPaintView::NotationPaintView(QQuickItem* parent)
    : AbstractNotationPaintView(parent), m_voiceIO(std::make_unique<NativeVoiceIO>())
{
#ifdef Q_OS_WIN
    m_voiceIO->timer.setInterval(200);
    connect(&m_voiceIO->timer, &QTimer::timeout, this, [this]() {
        if (m_voiceIO->output && (m_voiceIO->playbackHeader.dwFlags & WHDR_DONE)) {
            closeVoicePlayback();
        }
        if (voiceRecording() && QDateTime::currentMSecsSinceEpoch() - m_voiceIO->startedMs >= 240000) {
            stopVoiceRecording();
        }
    });
#endif
}

NotationPaintView::~NotationPaintView()
{
    discardVoiceRecording();
    closeVoicePlayback();
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
    notation->interaction()->selectionChanged().onNotify(this, [this]() { emit voiceStudioSelectionChanged(); });
}

void NotationPaintView::onUnloadNotation(INotationPtr notation)
{
    discardVoiceRecording();
    closeVoicePlayback();
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

QString NotationPaintView::voiceStudioCopyPath() const
{
    return m_voiceStudioCopy && studioProjectSession()->project()
           ? studioProjectSession()->project()->path().toQString() : QString();
}

bool NotationPaintView::voiceStudioHasAudio() const
{
    return !m_voicePeaks.isEmpty();
}

int NotationPaintView::voiceStudioAudioLengthMs() const
{
    return m_voiceSampleRate > 0 ? int(qint64(m_voiceFrames) * 1000 / m_voiceSampleRate) : 0;
}

int NotationPaintView::voiceStudioStaffCount() const
{
    return notation() && notation()->elements()->msScore() ? int(notation()->elements()->msScore()->nstaves()) : 0;
}

QVariantMap NotationPaintView::selectedVoiceClip() const
{
    QVariantMap result;
    if (!m_voiceStudioCopy || !notation() || !studioProjectSession()->project()) {
        return result;
    }
    const auto notes = notation()->interaction()->selection()->notes();
    if (notes.size() != 1 || !notes.front()->chord()) {
        return result;
    }
    const auto* note = notes.front();
    const auto* chord = note->chord();
    const auto& chordNotes = chord->notes();
    const auto found = std::find(chordNotes.begin(), chordNotes.end(), note);
    if (found == chordNotes.end()) {
        return result;
    }
    const int tick = chord->tick().ticks();
    const int track = int(note->track());
    const int noteIndex = int(std::distance(chordNotes.begin(), found));
    result.insert("tick", tick);
    result.insert("track", track);
    result.insert("noteIndex", noteIndex);
    result.insert("writtenPitch", note->pitch());
    result.insert("outputPitch", note->pitch());
    result.insert("scoreOffsetTicks", 0);
    result.insert("stretchPercent", 100);
    static const char* names[] = { "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B" };
    result.insert("writtenName", QString::fromUtf8(names[note->pitch() % 12]) + QString::number(note->pitch() / 12 - 1));
    const QJsonArray clips
        = QJsonDocument::fromJson(studioProjectSession()->project()->voiceStudioSession()).object().value("clips").toArray();
    for (const auto& item : clips) {
        const QJsonObject clip = item.toObject();
        if (clip.value("tick").toInt(-1) == tick && clip.value("track").toInt(-1) == track
            && clip.value("noteIndex").toInt(-1) == noteIndex) {
            result.insert("tagged", true);
            result.insert("sourceStartMs", clip.value("sourceStartMs").toInt());
            result.insert("sourceEndMs", clip.value("sourceEndMs").toInt());
            result.insert("scoreOffsetTicks", clip.value("scoreOffsetTicks").toInt());
            result.insert("stretchPercent", int(std::round(clip.value("stretch").toDouble(1) * 100)));
            result.insert("outputPitch", clip.value("outputPitch").toInt(note->pitch()));
            break;
        }
    }
    return result;
}

QString NotationPaintView::updateSelectedVoiceClip(int offsetTicks, int stretchPercent, int outputPitch)
{
    const QVariantMap selected = selectedVoiceClip();
    if (!selected.value("tagged").toBool() || offsetTicks < -9600 || offsetTicks > 9600
        || stretchPercent < 40 || stretchPercent > 250 || outputPitch < 0 || outputPitch > 127) {
        return QStringLiteral("Tag one selected note first; use offset ±9600 ticks, stretch 40–250%, and MIDI pitch 0–127.");
    }
    if (voice::clipStartsBeforePlayback(selected.value("tick").toInt(), offsetTicks)) {
        return QStringLiteral("This offset moves the note before the score starts; reduce the negative offset.");
    }
    const auto project = studioProjectSession()->project();
    QJsonObject root = QJsonDocument::fromJson(project->voiceStudioSession()).object();
    QJsonArray clips = root.value("clips").toArray();
    for (int i = 0; i < clips.size(); ++i) {
        QJsonObject clip = clips.at(i).toObject();
        if (clip.value("tick").toInt(-1) != selected.value("tick").toInt()
            || clip.value("track").toInt(-1) != selected.value("track").toInt()
            || clip.value("noteIndex").toInt(-1) != selected.value("noteIndex").toInt()) {
            continue;
        }
        clip.insert("scoreOffsetTicks", offsetTicks);
        clip.insert("stretch", stretchPercent / 100.0);
        clip.insert("outputPitch", outputPitch);
        clips.replace(i, clip);
        root.insert("clips", clips);
        if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
            return QStringLiteral("Could not save this clip edit to the score copy.");
        }
        emit voiceStudioSelectionChanged();
        scheduleRedraw();
        return {};
    }
    return QStringLiteral("The selected note's tag was not found.");
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
    if (clips.size() >= 1024) {
        return QStringLiteral("This score has too many source tags; use a shorter section.");
    }
    QJsonObject clip;
    clip.insert("tick", tick);
    clip.insert("track", track);
    clip.insert("noteIndex", noteIndex);
    clip.insert("writtenPitch", note->pitch());
    clip.insert("sourceStartMs", sourceStartMs);
    clip.insert("sourceEndMs", sourceEndMs);
    clip.insert("scoreOffsetTicks", 0);
    clip.insert("durationTicks", chord->actualTicks().ticks());
    clip.insert("stretch", 1.0);
    clips.append(clip);
    root.insert("clips", clips);
    if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
        return QStringLiteral("Could not save this note tag in the score copy.");
    }
    emit voiceStudioSelectionChanged();
    scheduleRedraw();
    return {};
}

void NotationPaintView::refreshVoiceStudio(const QByteArray& sourceOverride)
{
    const auto project = studioProjectSession()->project();
    m_voiceStudioCopy = project && QJsonDocument::fromJson(project->voiceStudioSession()).object().value("version").toInt() == 1;
    const QByteArray nextWav
        = m_voiceStudioCopy ? (sourceOverride.isEmpty() ? project->voiceStudioSource() : sourceOverride) : QByteArray();
    if (nextWav == m_voiceWav && !m_voiceSamples.empty()) {
        emit voiceStudioChanged();
        scheduleRedraw();
        return;
    }
    m_voiceWav = nextWav;
    m_voicePeaks.clear();
    m_voiceSamples.clear();
    m_voiceFrames = 0;
    m_voiceSampleRate = 0;
    m_processingRate = 0;
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
                && dataSize >= channels * 2 && qint64(dataSize) <= qint64(m_voiceSampleRate) * channels * 2 * 240) {
                m_voiceFrames = dataSize / (channels * 2);
                m_processingRate = std::min(m_voiceSampleRate, 48000);
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
                const int count = int(qint64(m_voiceFrames) * m_processingRate / m_voiceSampleRate);
                m_voiceSamples.resize(count);
                for (int i = 0; i < count; ++i) {
                    const int frame = int(qint64(i) * m_voiceSampleRate / m_processingRate);
                    float mono = 0;
                    for (int ch = 0; ch < channels; ++ch) {
                        mono += qFromLittleEndian<qint16>(samples + (frame * channels + ch) * 2) / (32768.0f * channels);
                    }
                    m_voiceSamples[i] = mono;
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
        return QStringLiteral("Use uncompressed 16-bit mono/stereo RIFF WAV, at most four minutes long.");
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
            const auto positionForTick = [&anchors, left, right, startTick, endTick](double tick) {
                if (tick <= startTick) {
                    return left;
                }
                if (tick >= endTick) {
                    return right;
                }
                for (size_t i = 1; i < anchors.size(); ++i) {
                    if (tick > anchors[i].second && i + 1 < anchors.size()) {
                        continue;
                    }
                    const double dt = anchors[i].second - anchors[i - 1].second;
                    return dt > 0 ? anchors[i - 1].first + (anchors[i].first - anchors[i - 1].first)
                           * (tick - anchors[i - 1].second) / dt : anchors[i].first;
                }
                return right;
            };
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
                const QJsonObject clip = value.toObject();
                const double tick = clip.value("tick").toInt(-1) + clip.value("scoreOffsetTicks").toInt();
                const double length = clip.value("durationTicks").toInt(480) * clip.value("stretch").toDouble(1);
                if (tick >= endTick || tick + length <= startTick || length <= 0) {
                    continue;
                }
                const double x1 = positionForTick(std::max(tick, startTick));
                const double x2 = positionForTick(std::min(tick + length, endTick));
                if (x2 <= x1) {
                    continue;
                }
                const double startFraction = (std::max(tick, startTick) - tick) / length;
                const double visibleFraction = (std::min(tick + length, endTick) - std::max(tick, startTick)) / length;
                const int beginMs = clip.value("sourceStartMs").toInt();
                const int endMs = clip.value("sourceEndMs").toInt();
                painter->setPen(QPen(QColor(235, 100, 55), 2));
                for (int col = 0; col <= std::min(1024, int(x2 - x1)); ++col) {
                    const double x = x1 + col;
                    const double fraction = startFraction + visibleFraction * (x - x1) / (x2 - x1);
                    const double sourceMs = beginMs + (endMs - beginMs) * fraction;
                    const int bin = std::clamp(int(sourceMs / (sourceDuration * 1000) * m_voicePeaks.size()), 0,
                                               int(m_voicePeaks.size()) - 1);
                    const double amplitude = 12 * m_voicePeaks.at(bin);
                    const auto top = fromLogical(muse::PointF(x, centerY - amplitude));
                    const auto bottom = fromLogical(muse::PointF(x, centerY + amplitude));
                    painter->drawLine(QPointF(top.x(), top.y()), QPointF(bottom.x(), bottom.y()));
                }
                const auto top = fromLogical(muse::PointF(x1, centerY - 13));
                const auto bottom = fromLogical(muse::PointF(x1, centerY + 13));
                painter->drawLine(QPointF(top.x(), top.y()), QPointF(bottom.x(), bottom.y()));
                painter->setPen(QPen(QColor(34, 130, 186, 180), 1));
            }
        }
    }
    painter->restore();
}

static QByteArray makeVoiceWav(const std::vector<float>& samples, int rate)
{
    const quint32 dataSize = quint32(samples.size() * 2);
    QByteArray result(44 + dataSize, '\0');
    char* data = result.data();
    memcpy(data, "RIFF", 4);
    qToLittleEndian<quint32>(36 + dataSize, reinterpret_cast<uchar*>(data + 4));
    memcpy(data + 8, "WAVEfmt ", 8);
    qToLittleEndian<quint32>(16, reinterpret_cast<uchar*>(data + 16));
    qToLittleEndian<quint16>(1, reinterpret_cast<uchar*>(data + 20));
    qToLittleEndian<quint16>(1, reinterpret_cast<uchar*>(data + 22));
    qToLittleEndian<quint32>(quint32(rate), reinterpret_cast<uchar*>(data + 24));
    qToLittleEndian<quint32>(quint32(rate * 2), reinterpret_cast<uchar*>(data + 28));
    qToLittleEndian<quint16>(2, reinterpret_cast<uchar*>(data + 32));
    qToLittleEndian<quint16>(16, reinterpret_cast<uchar*>(data + 34));
    memcpy(data + 36, "data", 4);
    qToLittleEndian<quint32>(dataSize, reinterpret_cast<uchar*>(data + 40));
    float peak = 0;
    for (float sample : samples) {
        peak = std::max(peak, std::abs(sample));
    }
    const float gain = peak > 0.97f ? 0.97f / peak : 1.0f;
    for (size_t i = 0; i < samples.size(); ++i) {
        const qint16 value = qint16(std::round(std::clamp(samples[i] * gain, -1.0f, 1.0f) * 32767));
        qToLittleEndian<qint16>(value, reinterpret_cast<uchar*>(data + 44 + i * 2));
    }
    return result;
}

static QString writeVoiceExport(const QUrl& destination, const std::vector<float>& samples, int rate,
                                const muse::io::path_t& scorePath)
{
    if (!destination.isLocalFile() || samples.empty() || rate < 8000 || samples.size() > size_t(rate) * 240) {
        return QStringLiteral("Choose a local WAV output and a nonempty render shorter than four minutes.");
    }
    const QFileInfo target(destination.toLocalFile());
    if (target.suffix().compare("wav", Qt::CaseInsensitive) != 0 || target.isSymbolicLink()
        || target.absoluteFilePath() == QFileInfo(scorePath.toQString()).absoluteFilePath()) {
        return QStringLiteral("Choose a .wav export path separate from the score copy.");
    }
    QSaveFile file(target.absoluteFilePath());
    if (!file.open(QIODevice::WriteOnly)) {
        return QStringLiteral("Cannot write this WAV output path.");
    }
    const QByteArray wav = makeVoiceWav(samples, rate);
    if (file.write(wav) != wav.size() || !file.commit()) {
        return QStringLiteral("WAV export failed; check free disk space and permissions.");
    }
    return {};
}

std::vector<float> NotationPaintView::selectedVoiceSamples(bool processed, int transpose, QString& error) const
{
    const QVariantMap selected = selectedVoiceClip();
    if (!selected.value("tagged").toBool() || m_voiceSamples.empty() || transpose < -24 || transpose > 24) {
        error = QStringLiteral("Select a tagged written note and choose a transposition within 24 semitones.");
        return {};
    }
    const int begin = int(qint64(selected.value("sourceStartMs").toInt()) * m_processingRate / 1000);
    const int end = int(qint64(selected.value("sourceEndMs").toInt()) * m_processingRate / 1000);
    if (begin < 0 || end > int(m_voiceSamples.size()) || end - begin < m_processingRate * 0.075) {
        error = QStringLiteral("The selected source slice is invalid or shorter than 75 ms.");
        return {};
    }
    std::vector<float> output;
    if (!processed) {
        output.assign(m_voiceSamples.begin() + begin, m_voiceSamples.begin() + end);
    } else {
        const int target = selected.value("outputPitch").toInt() + transpose;
        const auto* score = notation()->elements()->msScore();
        const int tick = selected.value("tick").toInt();
        const auto& timeline = score->tempoTimeline(false);
        const auto notes = notation()->interaction()->selection()->notes();
        if (notes.size() != 1 || target < 0 || target > 127) {
            error = QStringLiteral("Select one pitched note in the supported MIDI range.");
            return {};
        }
        const int noteEnd = tick + notes.front()->chord()->actualTicks().ticks();
        const double length = (timeline.utick2utime(noteEnd) - timeline.utick2utime(tick))
                              * selected.value("stretchPercent").toDouble() / 100.0;
        if (!std::isfinite(length) || length <= 0 || length > 240) {
            error = QStringLiteral("The selected note exceeds the four-minute preview limit.");
            return {};
        }
        const int frames = int(std::round(length * m_processingRate));
        try {
            output = voice::synthesize(m_voiceSamples, m_processingRate, begin, end,
                                       440.0 * std::pow(2.0, (target - 69) / 12.0), frames);
        } catch (const std::exception& e) {
            error = QString::fromUtf8(e.what());
            return {};
        }
    }
    return output;
}

QString NotationPaintView::exportSelectedVoicePreview(const QUrl& destination, bool processed, int transpose)
{
    QString error;
    const std::vector<float> samples = selectedVoiceSamples(processed, transpose, error);
    if (!error.isEmpty()) {
        return error;
    }
    return writeVoiceExport(destination, samples, m_processingRate, studioProjectSession()->project()->path());
}

QString NotationPaintView::exportVoiceStudioWav(const QUrl& destination, const QVariantList& staves, int transpose)
{
    if (!m_voiceStudioCopy || m_voiceSamples.empty() || !notation() || !studioProjectSession()->project()
        || staves.isEmpty() || staves.size() > 4 || transpose < -24 || transpose > 24) {
        return QStringLiteral("Import a voice and include one to four written choir parts; key shift is limited to ±24 semitones.");
    }
    auto* score = notation()->elements()->msScore();
    if (!score) {
        return QStringLiteral("No editable score is open.");
    }
    const auto& passages = score->repeatList(true);
    if (passages.empty()) {
        return QStringLiteral("The score has no playable written measures.");
    }
    QSet<int> selectedStaves;
    QSet<QString> selectedRoles;
    QHash<int, QString> roles;
    for (const QVariant& value : staves) {
        const QVariantMap mapping = value.toMap();
        const int staff = mapping.value("staff").toInt();
        const QString role = mapping.value("name").toString();
        if (staff < 0 || staff >= int(score->nstaves()) || selectedStaves.contains(staff)) {
            return QStringLiteral("Each included voice needs a distinct, existing written staff.");
        }
        if ((role != "S" && role != "A" && role != "T" && role != "B") || selectedRoles.contains(role)) {
            return QStringLiteral("Map each included written staff to a distinct choir voice label.");
        }
        selectedStaves.insert(staff);
        selectedRoles.insert(role);
        roles.insert(staff, role);
    }
    const auto project = studioProjectSession()->project();
    QJsonObject root = QJsonDocument::fromJson(project->voiceStudioSession()).object();
    const QJsonArray clips = root.value("clips").toArray();
    if (clips.isEmpty()) {
        return QStringLiteral("Tag a voiced source slice on at least one written note first.");
    }
    const auto& timeline = score->tempoTimeline(true);
    const int maxFrames = 240 * m_processingRate;
    std::vector<float> mix;
    std::map<std::pair<int, int>, voice::SourcePlan> preparedSlices;
    int rendered = 0;
    for (const engraving::RepeatSegment* passage : passages) {
        for (const engraving::Measure* measure : passage->measureList()) {
            for (const engraving::Segment* segment = measure->first(engraving::SegmentType::ChordRest);
                 segment; segment = segment->next(engraving::SegmentType::ChordRest)) {
                for (int staff : selectedStaves) {
                    for (int voiceIndex = 0; voiceIndex < 4; ++voiceIndex) {
                        const int track = staff * 4 + voiceIndex;
                        const auto* element = segment->element(track);
                        if (!element || !element->isChord()) {
                            continue;
                        }
                        const auto* chord = engraving::toChord(element);
                        const int tick = chord->tick().ticks();
                        for (size_t noteIndex = 0; noteIndex < chord->notes().size(); ++noteIndex) {
                            const auto* note = chord->notes()[noteIndex];
                            if (note->tieBack()) {
                                const auto* first = note->tieBack()->startNote();
                                if (first && first->chord()->tick().ticks() < passage->tick) {
                                    return QStringLiteral("A tie starts outside this repeat passage; its playback mapping is ambiguous.");
                                }
                                continue;
                            }
                            const QJsonObject clip = voice::clipForWrittenNote(clips, tick, track, int(noteIndex));
                            const int begin = int(qint64(clip.value("sourceStartMs").toInt()) * m_processingRate / 1000);
                            const int end = int(qint64(clip.value("sourceEndMs").toInt()) * m_processingRate / 1000);
                            const int offset = clip.value("scoreOffsetTicks").toInt();
                            const double stretch = clip.value("stretch").toDouble(1);
                            const int basePitch = clip.value("outputPitch").toInt(note->pitch());
                            const int target = basePitch + transpose;
                            if (begin < 0 || end > int(m_voiceSamples.size()) || end - begin < m_processingRate * 0.075
                                || offset < -9600 || offset > 9600 || stretch < 0.4 || stretch > 2.5
                                || target < 0 || target > 127) {
                                return QStringLiteral("A note has an invalid source slice, offset, stretch, or output pitch.");
                            }
                            const int playbackTick = passage->utick + tick - passage->tick;
                            if (voice::clipStartsBeforePlayback(playbackTick, offset)) {
                                return QStringLiteral("A clip begins before the score starts; reduce its negative offset.");
                            }
                            const double startSeconds = timeline.utick2utime(playbackTick + offset);
                            int endTick = tick + chord->actualTicks().ticks();
                            const engraving::Note* tied = note;
                            for (int ties = 0; ties < 64 && tied->tieFor() && tied->tieFor()->endNote(); ++ties) {
                                tied = tied->tieFor()->endNote();
                                endTick = tied->chord()->tick().ticks() + tied->chord()->actualTicks().ticks();
                            }
                            if (endTick > passage->endTick()) {
                                return QStringLiteral("A tied note crosses a repeat jump; edit the tie or export a shorter section.");
                            }
                            const double noteSeconds = timeline.utick2utime(playbackTick + endTick - tick)
                                                       - timeline.utick2utime(playbackTick);
                            if (!std::isfinite(startSeconds) || !std::isfinite(noteSeconds) || startSeconds < 0
                                || noteSeconds <= 0) {
                                return QStringLiteral("A written note has invalid playback timing; check its tempo and clip offset.");
                            }
                            if (startSeconds > 240 || noteSeconds * stretch > 240) {
                                return QStringLiteral("A written note or clip exceeds the four-minute render limit.");
                            }
                            const int start = int(std::round(startSeconds * m_processingRate));
                            const int frames = int(std::round(noteSeconds * stretch * m_processingRate));
                            if (start < 0 || frames <= 0 || start > maxFrames || frames > maxFrames - start) {
                                return QStringLiteral("A clip would exceed the four-minute render limit; move or shorten it.");
                            }
                            if (++rendered > 8000) {
                                return QStringLiteral("Too many notes for a single render; export a smaller score.");
                            }
                            std::vector<float> voiced;
                            try {
                                const auto key = std::make_pair(begin, end);
                                auto it = preparedSlices.find(key);
                                if (it == preparedSlices.end()) {
                                    it = preparedSlices.emplace(key, voice::prepare(m_voiceSamples, m_processingRate, begin, end)).first;
                                }
                                voiced = voice::synthesize(m_voiceSamples, m_processingRate, it->second,
                                                           440.0 * std::pow(2.0, (target - 69) / 12.0), frames);
                            } catch (const std::exception& e) {
                                return QStringLiteral("Written note %1: %2").arg(rendered).arg(QString::fromUtf8(e.what()));
                            }
                            if (mix.size() < size_t(start + frames)) {
                                mix.resize(start + frames, 0);
                            }
                            // Only spectral balance varies by role. This filter
                            // does not shift note periods or change score pitch.
                            const QString role = roles.value(staff);
                            const float warmth = role == "B" ? 0.8f : role == "A" ? 0.6f : role == "T" ? 0.5f : 0.3f;
                            const float brightness = role == "S" ? 0.75f : role == "T" ? 0.5f : 0.3f;
                            float low = 0;
                            const float gain = 0.7f / std::sqrt(float(staves.size()));
                            for (int i = 0; i < frames; ++i) {
                                low += 0.15f * (voiced[i] - low);
                                const float shaped = voiced[i] * (0.75f + warmth * 0.1f)
                                                     + low * warmth * 0.2f + (voiced[i] - low) * brightness * 0.2f;
                                mix[start + i] += shaped * gain;
                            }
                        }
                    }
                }
            }
        }
    }
    if (!rendered) {
        return QStringLiteral("The chosen staff subset contains no pitched written notes.");
    }
    mix.resize(std::min(size_t(maxFrames), mix.size() + size_t(m_processingRate / 20)), 0);
    const QString error = writeVoiceExport(destination, mix, m_processingRate, project->path());
    if (!error.isEmpty()) {
        return error;
    }
    root.insert("includedStaves", QJsonArray::fromVariantList(staves));
    root.insert("transposeSemitones", transpose);
    if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
        return QStringLiteral("WAV exported, but arrangement settings could not be saved in the score copy.");
    }
    emit voiceStudioChanged();
    return {};
}

bool NotationPaintView::voiceRecording() const
{
#ifdef Q_OS_WIN
    return m_voiceIO && m_voiceIO->input;
#else
    return false;
#endif
}

void NotationPaintView::discardVoiceRecording()
{
#ifdef Q_OS_WIN
    if (!voiceRecording()) {
        return;
    }
    waveInStop(m_voiceIO->input);
    waveInReset(m_voiceIO->input);
    waveInUnprepareHeader(m_voiceIO->input, &m_voiceIO->captureHeader, sizeof(WAVEHDR));
    waveInClose(m_voiceIO->input);
    m_voiceIO->input = nullptr;
    m_voiceIO->capture.clear();
    if (!m_voiceIO->output) {
        m_voiceIO->timer.stop();
    }
    emit voiceRecordingChanged();
#endif
}

void NotationPaintView::closeVoicePlayback()
{
#ifdef Q_OS_WIN
    if (!m_voiceIO || !m_voiceIO->output) {
        return;
    }
    waveOutReset(m_voiceIO->output);
    waveOutUnprepareHeader(m_voiceIO->output, &m_voiceIO->playbackHeader, sizeof(WAVEHDR));
    waveOutClose(m_voiceIO->output);
    m_voiceIO->output = nullptr;
    m_voiceIO->playing.clear();
    if (!voiceRecording()) {
        m_voiceIO->timer.stop();
    }
#endif
}

QString NotationPaintView::startVoiceRecording()
{
#ifdef Q_OS_WIN
    if (!m_voiceStudioCopy || !studioProjectSession()->project() || voiceRecording()) {
        return QStringLiteral("Open a Voice Studio copy and stop any current recording first.");
    }
    if (!QJsonDocument::fromJson(studioProjectSession()->project()->voiceStudioSession()).object().value("clips").toArray().isEmpty()) {
        return QStringLiteral("Existing note tags refer to the current source; recording over them is blocked.");
    }
    closeVoicePlayback();
    WAVEFORMATEX format {};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1;
    format.nSamplesPerSec = 48000;
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    if (waveInOpen(&m_voiceIO->input, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
        m_voiceIO->input = nullptr;
        return QStringLiteral("No usable Windows microphone device; connect one and allow desktop microphone access.");
    }
    m_voiceIO->capture.resize(int(format.nAvgBytesPerSec * 240));
    m_voiceIO->captureHeader = {};
    m_voiceIO->captureHeader.lpData = m_voiceIO->capture.data();
    m_voiceIO->captureHeader.dwBufferLength = DWORD(m_voiceIO->capture.size());
    const bool prepared = waveInPrepareHeader(m_voiceIO->input, &m_voiceIO->captureHeader, sizeof(WAVEHDR)) == MMSYSERR_NOERROR;
    const bool queued = prepared && waveInAddBuffer(m_voiceIO->input, &m_voiceIO->captureHeader, sizeof(WAVEHDR)) == MMSYSERR_NOERROR;
    const bool started = queued && waveInStart(m_voiceIO->input) == MMSYSERR_NOERROR;
    if (!started) {
        discardVoiceRecording();
        return QStringLiteral("Microphone capture could not start; check the recording device and Windows permissions.");
    }
    m_voiceIO->startedMs = QDateTime::currentMSecsSinceEpoch();
    m_voiceIO->timer.start();
    emit voiceRecordingChanged();
    return {};
#else
    return QStringLiteral("Native microphone capture currently requires Windows; import a local PCM WAV instead.");
#endif
}

QString NotationPaintView::stopVoiceRecording()
{
#ifdef Q_OS_WIN
    if (!voiceRecording() || !studioProjectSession()->project()) {
        return QStringLiteral("There is no active microphone recording.");
    }
    waveInStop(m_voiceIO->input);
    waveInReset(m_voiceIO->input);
    const int bytes = int(m_voiceIO->captureHeader.dwBytesRecorded & ~DWORD(1));
    if (bytes < 48000 * 2 / 10 || bytes > m_voiceIO->capture.size()) {
        discardVoiceRecording();
        return QStringLiteral("Record at least a tenth of a second before stopping.");
    }
    std::vector<float> source(bytes / 2);
    const uchar* data = reinterpret_cast<const uchar*>(m_voiceIO->capture.constData());
    for (int i = 0; i < int(source.size()); ++i) {
        source[i] = qFromLittleEndian<qint16>(data + i * 2) / 32768.0f;
    }
    discardVoiceRecording();
    const auto project = studioProjectSession()->project();
    if (!project->setVoiceStudioData(project->voiceStudioSession(), makeVoiceWav(source, 48000))) {
        return QStringLiteral("The microphone recording could not be embedded in this score copy.");
    }
    refreshVoiceStudio();
    return {};
#else
    return QStringLiteral("Native microphone capture currently requires Windows.");
#endif
}

QString NotationPaintView::auditionVoiceSlice(bool processed, int transpose)
{
#ifdef Q_OS_WIN
    if (voiceRecording()) {
        return QStringLiteral("Stop recording before auditioning a source slice.");
    }
    QString error;
    const std::vector<float> samples = selectedVoiceSamples(processed, transpose, error);
    if (!error.isEmpty()) {
        return error;
    }
    closeVoicePlayback();
    WAVEFORMATEX format {};
    format.wFormatTag = WAVE_FORMAT_PCM;
    format.nChannels = 1;
    format.nSamplesPerSec = DWORD(m_processingRate);
    format.wBitsPerSample = 16;
    format.nBlockAlign = 2;
    format.nAvgBytesPerSec = format.nSamplesPerSec * format.nBlockAlign;
    if (waveOutOpen(&m_voiceIO->output, WAVE_MAPPER, &format, 0, 0, CALLBACK_NULL) != MMSYSERR_NOERROR) {
        m_voiceIO->output = nullptr;
        return QStringLiteral("No usable Windows audio output device; export a preview WAV instead.");
    }
    m_voiceIO->playing = makeVoiceWav(samples, m_processingRate);
    m_voiceIO->playbackHeader = {};
    m_voiceIO->playbackHeader.lpData = m_voiceIO->playing.data() + 44;
    m_voiceIO->playbackHeader.dwBufferLength = DWORD(m_voiceIO->playing.size() - 44);
    const bool prepared = waveOutPrepareHeader(m_voiceIO->output, &m_voiceIO->playbackHeader, sizeof(WAVEHDR)) == MMSYSERR_NOERROR;
    if (!prepared || waveOutWrite(m_voiceIO->output, &m_voiceIO->playbackHeader, sizeof(WAVEHDR)) != MMSYSERR_NOERROR) {
        closeVoicePlayback();
        return QStringLiteral("Could not play the note preview; export a preview WAV instead.");
    }
    m_voiceIO->timer.start();
    return {};
#else
    Q_UNUSED(processed)
    Q_UNUSED(transpose)
    return QStringLiteral("Native audition currently requires Windows; export the note preview WAV instead.");
#endif
}

QVariantMap NotationPaintView::voiceStudioArrangement() const
{
    return studioProjectSession()->project()
           ? QJsonDocument::fromJson(studioProjectSession()->project()->voiceStudioSession()).object().toVariantMap()
           : QVariantMap();
}

QString NotationPaintView::voiceStudioNoteProgression(const QVariantList& staves, int transpose) const
{
    if (!notation() || !notation()->elements()->msScore() || staves.isEmpty() || transpose < -24 || transpose > 24) {
        return QStringLiteral("Include at least one written part and choose a valid arrangement shift.");
    }
    const auto* score = notation()->elements()->msScore();
    const auto& timeline = score->tempoTimeline(false);
    const QJsonArray clips = QJsonDocument::fromJson(studioProjectSession()->project()->voiceStudioSession())
                             .object().value("clips").toArray();
    QStringList lines;
    static const char* names[] = { "C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B" };
    for (const QVariant& value : staves) {
        const QVariantMap role = value.toMap();
        const int staff = role.value("staff").toInt();
        if (staff < 0 || staff >= int(score->nstaves())) {
            return QStringLiteral("A chosen voice has no written staff.");
        }
        QStringList notes;
        for (const engraving::Measure* measure = score->firstMeasure(); measure && notes.size() < 512; measure = measure->nextMeasure()) {
            for (const engraving::Segment* segment = measure->first(engraving::SegmentType::ChordRest);
                 segment && notes.size() < 512; segment = segment->next(engraving::SegmentType::ChordRest)) {
                for (int v = 0; v < 4 && notes.size() < 512; ++v) {
                    const auto* element = segment->element(staff * 4 + v);
                    if (!element || !element->isChord()) {
                        continue;
                    }
                    const auto* chord = engraving::toChord(element);
                    for (size_t n = 0; n < chord->notes().size(); ++n) {
                        const auto* note = chord->notes()[n];
                        if (note->tieBack()) {
                            continue;
                        }
                        int pitch = note->pitch();
                        for (const auto& clipValue : clips) {
                            const QJsonObject clip = clipValue.toObject();
                            if (clip.value("track").toInt(-1) == int(note->track())
                                && clip.value("tick").toInt(-1) == chord->tick().ticks()
                                && clip.value("noteIndex").toInt(-1) == int(n)) {
                                pitch = clip.value("outputPitch").toInt(pitch);
                                break;
                            }
                        }
                        pitch += transpose;
                        const QString target = pitch >= 0 && pitch < 128
                                               ? QString::fromUtf8(names[pitch % 12]) + QString::number(pitch / 12 - 1)
                                               : QStringLiteral("out of range");
                        notes.append(QStringLiteral("%1s %2→%3").arg(timeline.utick2utime(chord->tick().ticks()), 0, 'f', 2)
                                     .arg(QString::fromUtf8(names[note->pitch() % 12]) + QString::number(note->pitch() / 12 - 1))
                                     .arg(target));
                        if (notes.size() >= 512) {
                            notes.append(QStringLiteral("… more written notes omitted from preview"));
                            break;
                        }
                    }
                }
            }
        }
        lines.append(QStringLiteral("%1 · staff %2: %3").arg(role.value("name").toString())
                     .arg(staff + 1).arg(notes.join(QStringLiteral("  |  "))));
    }
    return lines.join(QStringLiteral("\n\n"));
}

QString NotationPaintView::saveVoiceStudioArrangement(const QVariantList& staves, int transpose)
{
    if (!m_voiceStudioCopy || !studioProjectSession()->project() || staves.isEmpty() || staves.size() > 4
        || transpose < -24 || transpose > 24 || !notation() || !notation()->elements()->msScore()) {
        return QStringLiteral("Include one to four written parts and choose a key shift within 24 semitones.");
    }
    QSet<int> seenStaves;
    QSet<QString> seenRoles;
    for (const QVariant& value : staves) {
        const QVariantMap part = value.toMap();
        const int staff = part.contains("staff") ? part.value("staff").toInt() : -1;
        const QString role = part.value("name").toString();
        if (staff < 0 || staff >= int(notation()->elements()->msScore()->nstaves()) || seenStaves.contains(staff)
            || (role != "S" && role != "A" && role != "T" && role != "B") || seenRoles.contains(role)) {
            return QStringLiteral("Each included choir voice must map to a different existing written staff.");
        }
        seenStaves.insert(staff);
        seenRoles.insert(role);
    }
    const auto project = studioProjectSession()->project();
    QJsonObject root = QJsonDocument::fromJson(project->voiceStudioSession()).object();
    root.insert("includedStaves", QJsonArray::fromVariantList(staves));
    root.insert("transposeSemitones", transpose);
    if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
        return QStringLiteral("Could not store the arrangement in the copied score.");
    }
    emit voiceStudioChanged();
    return {};
}

QString NotationPaintView::removeSelectedVoiceTag()
{
    const QVariantMap selected = selectedVoiceClip();
    if (!selected.value("tagged").toBool() || !studioProjectSession()->project()) {
        return QStringLiteral("Select a tagged note before removing its source slice.");
    }
    const auto project = studioProjectSession()->project();
    QJsonObject root = QJsonDocument::fromJson(project->voiceStudioSession()).object();
    QJsonArray clips = root.value("clips").toArray();
    for (int i = clips.size() - 1; i >= 0; --i) {
        const QJsonObject clip = clips.at(i).toObject();
        if (clip.value("tick").toInt(-1) == selected.value("tick").toInt()
            && clip.value("track").toInt(-1) == selected.value("track").toInt()
            && clip.value("noteIndex").toInt(-1) == selected.value("noteIndex").toInt()) {
            clips.removeAt(i);
        }
    }
    root.insert("clips", clips);
    if (!project->setVoiceStudioData(QJsonDocument(root).toJson(QJsonDocument::Compact), project->voiceStudioSource())) {
        return QStringLiteral("Could not remove the tag from the score copy.");
    }
    emit voiceStudioSelectionChanged();
    scheduleRedraw();
    return {};
}
