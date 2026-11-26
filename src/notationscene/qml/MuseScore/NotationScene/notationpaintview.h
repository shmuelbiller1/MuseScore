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
#include "project/inotationproject_fwd.h"

namespace mu::notation {
class NotationPaintView : public AbstractNotationPaintView
{
    Q_OBJECT
    QML_ELEMENT
    Q_PROPERTY(bool voiceStudioCopy READ voiceStudioCopy NOTIFY voiceStudioChanged)
    Q_PROPERTY(QString voiceStudioCopyPath READ voiceStudioCopyPath NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceStudioHasAudio READ voiceStudioHasAudio NOTIFY voiceStudioChanged)
    Q_PROPERTY(int voiceStudioAudioLengthMs READ voiceStudioAudioLengthMs NOTIFY voiceStudioChanged)
    Q_PROPERTY(int voiceStudioStaffCount READ voiceStudioStaffCount NOTIFY voiceStudioChanged)
    Q_PROPERTY(bool voiceRecording READ voiceRecording NOTIFY voiceRecordingChanged)

public:
    explicit NotationPaintView(QQuickItem* parent = nullptr);
    ~NotationPaintView() override;
    bool voiceStudioCopy() const;
    QString voiceStudioCopyPath() const;
    bool voiceStudioHasAudio() const;
    int voiceStudioAudioLengthMs() const;
    int voiceStudioStaffCount() const;
    Q_INVOKABLE int voiceStudioMeasureCount() const;
    Q_INVOKABLE QVariantMap voiceStudioSelectedMeasure(bool useEnd) const;
    Q_INVOKABLE QString selectVoiceStudioRange(int staffNumber, int firstMeasure, int lastMeasure);
    Q_INVOKABLE QString copyVoiceStudioRange();
    bool voiceRecording() const;
    Q_INVOKABLE QString startVoiceRecording();
    Q_INVOKABLE QString stopVoiceRecording();
    Q_INVOKABLE QString auditionVoiceSlice(bool processed, int transpose);
    Q_INVOKABLE QString importVoiceStudioWav(const QUrl& url);
    Q_INVOKABLE QString tagVoiceNote(int sourceStartMs, int sourceEndMs);
    Q_INVOKABLE QString removeSelectedVoiceTag();
    Q_INVOKABLE QVariantMap selectedVoiceClip() const;
    Q_INVOKABLE QString updateSelectedVoiceClip(int offsetTicks, int stretchPercent, int outputPitch);
    Q_INVOKABLE QString exportVoiceStudioWav(const QUrl& destination, const QVariantList& staves, int transpose);
    Q_INVOKABLE QString exportSelectedVoicePreview(const QUrl& destination, bool processed, int transpose);
    Q_INVOKABLE QString voiceStudioNoteProgression(const QVariantList& staves, int transpose) const;
    Q_INVOKABLE QVariantMap voiceStudioArrangement() const;
    Q_INVOKABLE QString saveVoiceStudioArrangement(const QVariantList& staves, int transpose);

signals:
    void voiceStudioChanged();
    void voiceStudioSelectionChanged();
    void voiceRecordingChanged();

private:
    muse::ContextInject<project::IProjectSession> studioProjectSession = { this };

    void paint(QPainter* painter) override;
    void paintVoiceWaveform(QPainter* painter);
    void paintVoiceProblems(QPainter* painter);
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
    project::INotationProjectPtr m_voiceStudioProject;
    struct NativeVoiceIO;
    std::unique_ptr<NativeVoiceIO> m_voiceIO;
};
}
