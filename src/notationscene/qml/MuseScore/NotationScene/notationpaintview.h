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
#include <QVariantList>
#include <QVariantMap>
#include <vector>
#include <memory>
#include <map>
#include <utility>

#include "abstractnotationpaintview.h"
#include "voicestudiorange.h"
#include "project/inotationproject_fwd.h"

namespace mu::notation {
class NotationPaintView : public AbstractNotationPaintView
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool voiceStudioCopy READ voiceStudioCopy NOTIFY voiceStudioChanged)
    Q_PROPERTY(QString voiceStudioCopyPath READ voiceStudioCopyPath NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceStudioHasAudio READ voiceStudioHasAudio NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceStudioMp3Available READ voiceStudioMp3Available CONSTANT)
    Q_PROPERTY(int voiceStudioAudioLengthMs READ voiceStudioAudioLengthMs NOTIFY voiceStudioChanged)
    Q_PROPERTY(int voiceStudioStaffCount READ voiceStudioStaffCount NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceRecording READ voiceRecording NOTIFY voiceRecordingChanged)
    Q_PROPERTY(bool voiceRangeDragMode READ voiceRangeDragMode NOTIFY voiceRangeDragModeChanged)

public:
    explicit NotationPaintView(QQuickItem* parent = nullptr);
    ~NotationPaintView() override;
    bool voiceStudioCopy() const;
    QString voiceStudioCopyPath() const;
    bool voiceStudioHasAudio() const;
    bool voiceStudioMp3Available() const;
    int voiceStudioAudioLengthMs() const;
    int voiceStudioStaffCount() const;
    Q_INVOKABLE int voiceStudioMeasureCount() const;
    Q_INVOKABLE QVariantMap voiceStudioSelectedMeasure(bool useEnd) const;
    Q_INVOKABLE QString selectVoiceStudioRange(int staffNumber, int firstMeasure, int lastMeasure);
    Q_INVOKABLE QString copyVoiceStudioRange();
    Q_INVOKABLE QString markVoiceNoteRangeStart();
    Q_INVOKABLE QString selectVoiceNoteThroughSelection();
    Q_INVOKABLE void setVoiceRangeDragMode(bool enabled);
    bool voiceRangeDragMode() const;
    bool voiceRecording() const;
    Q_INVOKABLE QString startVoiceRecording();
    Q_INVOKABLE QString stopVoiceRecording();
    Q_INVOKABLE QString auditionVoiceSlice(bool processed, int transpose);
    Q_INVOKABLE QString importVoiceStudioWav(const QUrl& url);
    Q_INVOKABLE QString tagVoiceNote(int sourceStartMs, int sourceEndMs);
    Q_INVOKABLE QString removeSelectedVoiceTag();
    Q_INVOKABLE QVariantMap selectedVoiceClip() const;
    Q_INVOKABLE QString updateSelectedVoiceClip(int offsetTicks, int stretchPercent, int outputPitch);
    Q_INVOKABLE QString exportVoiceStudioAudio(const QUrl& destination, const QVariantList& staves, int transpose, bool followDynamics,
                                               bool mp3);
    Q_INVOKABLE QString exportSelectedVoicePreview(const QUrl& destination, bool processed, int transpose);
    Q_INVOKABLE QString voiceStudioNoteProgression(const QVariantList& staves, int transpose) const;
    Q_INVOKABLE QVariantMap voiceStudioArrangement() const;
    Q_INVOKABLE QString saveVoiceStudioArrangement(const QVariantList& staves, int transpose, bool followDynamics);

signals:
    void voiceStudioChanged();
    void voiceStudioSelectionChanged();
    void voiceRecordingChanged();
    void voiceRangeDragModeChanged();

private:
    muse::ContextInject<project::IProjectSession> studioProjectSession = { this };

    void paint(QPainter* painter) override;
    void paintVoiceWaveform(QPainter* painter);
    void paintVoiceProblems(QPainter* painter);
    void mousePressEvent(QMouseEvent* event) override;
    void mouseMoveEvent(QMouseEvent* event) override;
    void mouseReleaseEvent(QMouseEvent* event) override;
    void mouseUngrabEvent() override;
    bool voiceNoteAt(const QPointF& pos, bool nearest, int staffOnly, voice_range::Endpoint& endpoint) const;
    QString selectVoiceNoteSpan(voice_range::Endpoint start, voice_range::Endpoint end, bool requireCopyable = true);
    void updateVoiceRangeDrag();
    void refreshVoiceStudio(const QByteArray& sourceOverride = {});
    std::vector<float> selectedVoiceSamples(bool processed, int transpose, QString& error) const;
    void closeVoicePlayback();
    void discardVoiceRecording();

    void onLoadNotation(INotationPtr notation) override;
    void onUnloadNotation(INotationPtr notation) override;

    void initZoomAndPosition() override;

    void onMatrixChanged(const muse::draw::Transform& oldMatrix, const muse::draw::Transform& newMatrix,
                         bool overrideZoomType = true) override;

    bool m_isLocalMatrixUpdate = false;
    QByteArray m_voiceWav;
    QVector<float> m_voicePeaks;
    int m_voiceFrames = 0;
    int m_voiceSampleRate = 0;
    int m_processingRate = 0;
    std::vector<float> m_voiceSamples;
    std::map<std::pair<int, int>, bool> m_voiceSliceValid;
    bool m_voiceStudioCopy = false;
    bool m_voiceRangeDragMode = false;
    bool m_voiceRangeDragging = false;
    voice_range::Endpoint m_voiceStartEndpoint;
    int m_voiceStartStaff = -1;
    voice_range::Endpoint m_voiceLastEndpoint;
    QPointF m_voiceDragPosition;
    QPointF m_voiceDragOrigin;
    QTimer m_voiceRangeScrollTimer;
    project::INotationProjectPtr m_voiceStudioProject;
    struct NativeVoiceIO;
    std::unique_ptr<NativeVoiceIO> m_voiceIO;
};
}
