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

pragma ComponentBehavior: Bound

import QtQuick
import QtQuick.Layouts
import QtQuick.Controls
import QtQuick.Dialogs

import Muse.Ui
import Muse.UiComponents
import MuseScore.NotationScene
import MuseScore.Braille
import MuseScore.Playback

import "internal"

FocusScope {
    id: root

    property alias name: notationView.objectName
    property alias publishMode: notationView.publishMode
    property alias readOnly: notationView.readOnly

    property alias paintView: notationView
    property var selectedVoiceClip: ({})

    function includedVoiceStaves() {
        let result = []
        if (sopranoVoice.checked) result.push({name: "S", staff: sopranoStaff.value - 1})
        if (altoVoice.checked) result.push({name: "A", staff: altoStaff.value - 1})
        if (tenorVoice.checked) result.push({name: "T", staff: tenorStaff.value - 1})
        if (bassVoice.checked) result.push({name: "B", staff: bassStaff.value - 1})
        return result
    }

    property alias isNavigatorVisible: notationNavigator.visible
    property alias isBraillePanelVisible: brailleViewLoader.active
    property alias isMainView: notationView.isMainView

    property alias defaultNavigationControl: fakeNavCtrl

    readonly property alias navigationSection: navSec
    readonly property alias navigationOrderEnd: searchPopup.navigationOrderEnd

    NavigationSection {
        id: navSec
        name: "NotationView"
        order: 5
        enabled: root.visible
    }

    QtObject {
        id: prv
        readonly property int scrollbarMargin: 4
    }

    NotationContextMenuModel {
        id: contextMenuModel
    }

    Component.onCompleted: {
        notationView.load()
    }

    ColumnLayout {
        anchors.fill: parent
        spacing: 0

        NotationSwitchPanel {
            id: tabPanel
            Layout.fillWidth: true

            navigationPanel.section: navSec
            navigationPanel.order: 1
        }

        SeparatorLine { visible: tabPanel.visible }

        // The native notation remains editable; this strip is only present
        // when the active score contains a Voice Studio session marker.
        RowLayout {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.leftMargin: 12
            Layout.rightMargin: 12
            spacing: 12

            Label {
                text: qsTrc("notationscene", "Voice Studio copy: %1").arg(notationView.voiceStudioCopyPath)
                Layout.maximumWidth: 360
                elide: Text.ElideMiddle
                ToolTip.visible: copyPathHover.containsMouse
                ToolTip.text: notationView.voiceStudioCopyPath
                MouseArea { id: copyPathHover; anchors.fill: parent; hoverEnabled: true; acceptedButtons: Qt.NoButton }
            }
            Button {
                text: qsTrc("notationscene", "Import voice WAV…")
                onClicked: voiceFileDialog.open()
            }
            Button {
                text: notationView.voiceRecording ? qsTrc("notationscene", "Stop recording")
                                                  : qsTrc("notationscene", "Record voice")
                onClicked: voiceStudioError.text = notationView.voiceRecording
                            ? notationView.stopVoiceRecording() : notationView.startVoiceRecording()
            }
            Label {
                text: notationView.voiceStudioHasAudio
                      ? qsTrc("notationscene", "Waveform follows written notes")
                      : qsTrc("notationscene", "No recording imported")
            }
            Label { text: qsTrc("notationscene", "Slice ms:") }
            SpinBox {
                id: sourceStart
                editable: true
                from: 0
                to: notationView.voiceStudioAudioLengthMs
            }
            SpinBox {
                id: sourceEnd
                editable: true
                from: 0
                to: notationView.voiceStudioAudioLengthMs
                value: Math.min(1000, to)
            }
            Button {
                text: qsTrc("notationscene", "Tag selected note")
                enabled: notationView.voiceStudioHasAudio
                onClicked: voiceStudioError.text = notationView.tagVoiceNote(sourceStart.value, sourceEnd.value)
            }
            Label {
                id: voiceStudioError
                text: ""
                color: "#b52d2d"
                visible: text.length > 0
                Layout.fillWidth: true
                elide: Text.ElideRight
            }
        }

        RowLayout {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.leftMargin: 12
            spacing: 8

            Label {
                text: root.selectedVoiceClip.writtenName
                      ? qsTrc("notationscene", "Written %1 / output MIDI %2")
                        .arg(root.selectedVoiceClip.writtenName).arg(root.selectedVoiceClip.outputPitch)
                      : qsTrc("notationscene", "Select one written note")
            }
            Label { text: qsTrc("notationscene", "Offset ticks") }
            SpinBox { id: clipOffset; from: -9600; to: 9600; editable: true }
            Label { text: qsTrc("notationscene", "Stretch %") }
            SpinBox { id: clipStretch; from: 40; to: 250; value: 100; editable: true }
            Label { text: qsTrc("notationscene", "Output MIDI") }
            SpinBox { id: clipPitch; from: 0; to: 127; value: 60; editable: true }
            Button {
                text: qsTrc("notationscene", "Apply clip edit")
                enabled: root.selectedVoiceClip.tagged === true
                onClicked: voiceStudioError.text = notationView.updateSelectedVoiceClip(
                               clipOffset.value, clipStretch.value, clipPitch.value)
            }
            Button {
                text: qsTrc("notationscene", "Remove tag")
                enabled: root.selectedVoiceClip.tagged === true
                onClicked: voiceStudioError.text = notationView.removeSelectedVoiceTag()
            }
        }

        ScrollView {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.preferredHeight: 55
            RowLayout {
                spacing: 8
                Label { text: qsTrc("notationscene", "Written choir parts (staff number):") }
                CheckBox { id: sopranoVoice; text: "S"; checked: true }
                SpinBox { id: sopranoStaff; from: 1; to: Math.max(1, notationView.voiceStudioStaffCount); value: 1 }
                CheckBox { id: altoVoice; text: "A" }
                SpinBox { id: altoStaff; from: 1; to: Math.max(1, notationView.voiceStudioStaffCount); value: Math.min(2, to) }
                CheckBox { id: tenorVoice; text: "T" }
                SpinBox { id: tenorStaff; from: 1; to: Math.max(1, notationView.voiceStudioStaffCount); value: Math.min(3, to) }
                CheckBox { id: bassVoice; text: "B" }
                SpinBox { id: bassStaff; from: 1; to: Math.max(1, notationView.voiceStudioStaffCount); value: Math.min(4, to) }
                Label { text: qsTrc("notationscene", "Arrangement semitones") }
                SpinBox { id: arrangementShift; from: -24; to: 24; editable: true }
                Label { text: qsTrc("notationscene", "A minor → G minor: −2") }
                CheckBox {
                    id: followWrittenDynamics
                    text: qsTrc("notationscene", "Follow written p / mf / f in choir export")
                    ToolTip.text: qsTrc("notationscene", "Optional: each staff's written dynamic applies from its note until the next dynamic; mf returns to the reference level. Crescendo hairpins are not included.")
                    ToolTip.visible: hovered
                }
                Button {
                    text: qsTrc("notationscene", "Save arrangement")
                    onClicked: voiceStudioError.text = notationView.saveVoiceStudioArrangement(
                               root.includedVoiceStaves(), arrangementShift.value, followWrittenDynamics.checked)
                }
                Button {
                    text: qsTrc("notationscene", "Written/output note progression")
                    onClicked: {
                        progressionText.text = notationView.voiceStudioNoteProgression(
                                               root.includedVoiceStaves(), arrangementShift.value)
                        progressionDialog.open()
                    }
                }
                Button {
                    text: qsTrc("notationscene", "Export processed WAV…")
                    enabled: notationView.voiceStudioHasAudio
                    onClicked: { voiceExportDialog.mp3 = false; voiceExportDialog.open() }
                }
                Button {
                    text: qsTrc("notationscene", "Export processed MP3…")
                    visible: notationView.voiceStudioMp3Available
                    enabled: notationView.voiceStudioHasAudio
                    onClicked: { voiceExportDialog.mp3 = true; voiceExportDialog.open() }
                }
                Button {
                    text: qsTrc("notationscene", "Hear raw")
                    enabled: root.selectedVoiceClip.tagged === true
                    onClicked: voiceStudioError.text = notationView.auditionVoiceSlice(false, arrangementShift.value)
                }
                Button {
                    text: qsTrc("notationscene", "Hear processed")
                    enabled: root.selectedVoiceClip.tagged === true
                    onClicked: voiceStudioError.text = notationView.auditionVoiceSlice(true, arrangementShift.value)
                }
                Button {
                    text: qsTrc("notationscene", "Save raw slice WAV…")
                    enabled: root.selectedVoiceClip.tagged === true
                    onClicked: { voicePreviewDialog.processed = false; voicePreviewDialog.open() }
                }
                Button {
                    text: qsTrc("notationscene", "Save processed note WAV…")
                    enabled: root.selectedVoiceClip.tagged === true
                    onClicked: { voicePreviewDialog.processed = true; voicePreviewDialog.open() }
                }
            }
        }

        Label {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.leftMargin: 12
            Layout.rightMargin: 12
            wrapMode: Text.WordWrap
            text: qsTrc("notationscene", "Select exact notes with the buttons below or switch on drag-select, press on a note/rest, drag toward the last note (hold at an edge to scroll across pages), and release. Copy the selection, click the destination note/rest, then Ctrl+V. The copied notation can be edited separately; audio tags are not copied. A red outline marks a note that cannot render. To change choir loudness, select a note and apply p, mf or f from Palettes → Dynamics; add mf later to return to the reference level, then enable Follow written dynamics before export.")
        }

        ScrollView {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.preferredHeight: 55
            RowLayout {
                spacing: 8
                Label { text: qsTrc("notationscene", "Written range · staff") }
                SpinBox { id: rangeStaff; from: 1; to: Math.max(1, notationView.voiceStudioStaffCount); value: 1 }
                Label { text: qsTrc("notationscene", "from measure") }
                SpinBox { id: rangeFirst; from: 1; to: 10000; value: 1; editable: true }
                Button {
                    text: qsTrc("notationscene", "From selected")
                    onClicked: {
                        const point = notationView.voiceStudioSelectedMeasure(false)
                        if (point.measure) {
                            rangeFirst.value = point.measure
                            rangeStaff.value = point.staff
                            voiceStudioError.text = ""
                        } else {
                            voiceStudioError.text = qsTrc("notationscene", "Click a source note, rest, or measure first.")
                        }
                    }
                }
                Label { text: qsTrc("notationscene", "through measure") }
                SpinBox { id: rangeLast; from: 1; to: 10000; value: 2; editable: true }
                Button {
                    text: qsTrc("notationscene", "Through selected")
                    onClicked: {
                        const point = notationView.voiceStudioSelectedMeasure(true)
                        if (point.measure && point.staff === rangeStaff.value) {
                            rangeLast.value = point.measure
                            voiceStudioError.text = ""
                        } else {
                            voiceStudioError.text = qsTrc("notationscene", "Click the ending note or measure on the same source staff.")
                        }
                    }
                }
                Button {
                    text: qsTrc("notationscene", "Select full range")
                    onClicked: voiceStudioError.text = notationView.selectVoiceStudioRange(
                               rangeStaff.value, rangeFirst.value, rangeLast.value)
                }
                Button {
                    text: qsTrc("notationscene", "Select entire staff")
                    onClicked: {
                        rangeFirst.value = 1
                        rangeLast.value = notationView.voiceStudioMeasureCount()
                        voiceStudioError.text = notationView.selectVoiceStudioRange(
                                               rangeStaff.value, rangeFirst.value, rangeLast.value)
                    }
                }
                Button {
                    text: qsTrc("notationscene", "Copy selected range")
                    onClicked: voiceStudioError.text = notationView.copyVoiceStudioRange()
                }
            }
        }

        ScrollView {
            visible: notationView.voiceStudioCopy
            Layout.fillWidth: true
            Layout.preferredHeight: 55
            RowLayout {
                spacing: 8
                Label { text: qsTrc("notationscene", "Exact note range (one staff):") }
                Button {
                    text: qsTrc("notationscene", "Mark clicked start")
                    onClicked: voiceStudioError.text = notationView.markVoiceNoteRangeStart()
                }
                Button {
                    text: qsTrc("notationscene", "Select through clicked end")
                    onClicked: voiceStudioError.text = notationView.selectVoiceNoteThroughSelection()
                }
                Button {
                    text: notationView.voiceRangeDragMode
                          ? qsTrc("notationscene", "Cancel drag selection")
                          : qsTrc("notationscene", "Drag-select notes")
                    onClicked: notationView.setVoiceRangeDragMode(!notationView.voiceRangeDragMode)
                }
                Button {
                    text: qsTrc("notationscene", "Copy exact range")
                    onClicked: voiceStudioError.text = notationView.copyVoiceStudioRange()
                }
            }
        }

        Connections {
            target: notationView
            function onVoiceStudioChanged() {
                const saved = notationView.voiceStudioArrangement()
                const parts = saved.includedStaves
                if (!parts || parts.length === 0) return
                const role = name => parts.find(part => part.name === name)
                const s = role("S"), a = role("A"), t = role("T"), b = role("B")
                sopranoVoice.checked = !!s
                altoVoice.checked = !!a
                tenorVoice.checked = !!t
                bassVoice.checked = !!b
                if (s) sopranoStaff.value = s.staff + 1
                if (a) altoStaff.value = a.staff + 1
                if (t) tenorStaff.value = t.staff + 1
                if (b) bassStaff.value = b.staff + 1
                arrangementShift.value = saved.transposeSemitones ?? 0
                followWrittenDynamics.checked = saved.followDynamics === true
            }
            function onVoiceStudioSelectionChanged() {
                root.selectedVoiceClip = notationView.selectedVoiceClip()
                if (root.selectedVoiceClip.tagged) {
                    sourceStart.value = root.selectedVoiceClip.sourceStartMs
                    sourceEnd.value = root.selectedVoiceClip.sourceEndMs
                }
                clipOffset.value = root.selectedVoiceClip.scoreOffsetTicks ?? 0
                clipStretch.value = root.selectedVoiceClip.stretchPercent ?? 100
                clipPitch.value = root.selectedVoiceClip.outputPitch ?? 60
            }
        }

        Dialog {
            id: progressionDialog
            title: qsTrc("notationscene", "Written and output note progression")
            modal: true
            width: Math.min(root.width - 40, 950)
            height: Math.min(root.height - 40, 430)
            anchors.centerIn: Overlay.overlay
            standardButtons: Dialog.Ok
            ScrollView {
                anchors.fill: parent
                TextArea { id: progressionText; readOnly: true; wrapMode: TextEdit.Wrap }
            }
        }

        FileDialog {
            id: voiceExportDialog
            property bool mp3: false
            fileMode: FileDialog.SaveFile
            title: mp3 ? qsTrc("notationscene", "Export processed choir MP3")
                       : qsTrc("notationscene", "Export processed choir WAV")
            nameFilters: mp3 ? ["MP3 audio (*.mp3)"] : ["WAV audio (*.wav)"]
            onAccepted: voiceStudioError.text = notationView.exportVoiceStudioAudio(
                            selectedFile, root.includedVoiceStaves(), arrangementShift.value,
                            followWrittenDynamics.checked, mp3)
        }
        FileDialog {
            id: voicePreviewDialog
            property bool processed: false
            fileMode: FileDialog.SaveFile
            title: processed ? qsTrc("notationscene", "Save processed note preview")
                             : qsTrc("notationscene", "Save original source slice")
            nameFilters: ["WAV audio (*.wav)"]
            onAccepted: voiceStudioError.text = notationView.exportSelectedVoicePreview(
                            selectedFile, processed, arrangementShift.value)
        }

        FileDialog {
            id: voiceFileDialog
            title: qsTrc("notationscene", "Import a local 16-bit PCM WAV")
            nameFilters: ["WAV audio (*.wav)"]
            onAccepted: voiceStudioError.text = notationView.importVoiceStudioWav(selectedFile)
        }

        SplitView {
            id: splitView

            Layout.fillWidth: true
            Layout.fillHeight: true

            orientation: notationNavigator.orientation === Qt.Horizontal ? Qt.Vertical : Qt.Horizontal

            StyledViewScrollAndZoomArea {
                SplitView.fillWidth: true
                SplitView.fillHeight: true

                horizontalScrollbarSize: notationView.horizontalScrollbarSize
                startHorizontalScrollPosition: notationView.startHorizontalScrollPosition

                verticalScrollbarSize: notationView.verticalScrollbarSize
                startVerticalScrollPosition: notationView.startVerticalScrollPosition

                NotationPaintView {
                    id: notationView
                    anchors.fill: parent

                    property NavigationPanel navigationPanel: NavigationPanel {
                        name: "ScoreView"
                        section: navSec
                        enabled: notationView.enabled && notationView.visible
                        direction: NavigationPanel.Both
                        order: tabPanel.navigationPanel.order + 1
                    }

                    NavigationControl {
                        id: fakeNavCtrl
                        name: "Score"
                        enabled: notationView.enabled && notationView.visible

                        panel: notationView.navigationPanel
                        order: 1

                        onActiveChanged: {
                            if (fakeNavCtrl.active) {
                                notationView.forceFocusIn()

                                if (notationView.navigationPanel.highlight) {
                                    notationView.selectOnNavigationActive()
                                }
                            } else {
                                notationView.focus = false
                            }
                        }
                    }

                    NavigationFocusBorder {
                        navigationCtrl: fakeNavCtrl
                        drawOutsideParent: false
                    }

                    Rectangle {
                        id: playbackCursor

                        Component.onCompleted: {
                            notationView.setPlaybackCursorItem(playbackCursor)
                        }
                    }

                    onActiveFocusRequested: {
                        fakeNavCtrl.requestActive()
                    }

                    onShowContextMenuRequested: function (elementType, viewPos) {
                        contextMenuModel.loadItems(elementType)
                        contextMenuLoader.show(viewPos, contextMenuModel.items)
                    }

                    onHideContextMenuRequested: {
                        contextMenuLoader.close()
                    }

                    onShowSearchRequested: {
                        searchPopup.show()        
                    }

                    onShowElementPopupRequested: function (popupType) {
                        popUpLoader.updateShow(popupType);
                    }

                    onHideElementPopupRequested: {
                        popUpLoader.updateShow(AbstractElementPopupModel.TYPE_UNDEFINED);
                    }

                    onViewportChanged: {
                        notationNavigator.setCursorRect(viewport)
                    }

                    ContextMenuLoader {
                        id: contextMenuLoader

                        onHandleMenuItem: function(itemId) {
                            contextMenuModel.handleMenuItem(itemId)
                        }

                        onOpened: notationView.onContextMenuIsOpenChanged(true)
                        onClosed: notationView.onContextMenuIsOpenChanged(false)
                    }

                    ElementPopupLoader {
                        id: popUpLoader

                        notationViewNavigationSection: navSec
                        navigationOrderStart: notationView.navigationPanel.order + 1

                        property int popupType: AbstractElementPopupModel.TYPE_UNDEFINED
                        property bool updateShowScheduled: false

                        function updateShow(popupType) {
                            this.popupType = popupType;
                            if (!updateShowScheduled) {
                                Qt.callLater(doUpdateShow)
                                updateShowScheduled = true;
                            }
                        }

                        function doUpdateShow() {
                            updateShowScheduled = false;

                            if (popupType !== AbstractElementPopupModel.TYPE_UNDEFINED) {
                                show(popupType);
                            } else {
                                close();
                            }
                        }

                        onOpened: function(popupType) {
                            notationView.onElementPopupIsOpenChanged(popupType)
                        }

                        onClosed: {
                            notationView.onElementPopupIsOpenChanged(AbstractElementPopupModel.TYPE_UNDEFINED)
                        }
                    }

                    NotationRegionsBeingProcessedView {
                        notationViewRect: Qt.rect(notationView.x, notationView.y, notationView.width, notationView.height)
                        notationViewMatrix: notationView.matrix
                    }
                }

                onPinchToZoom: function(scale, pos) {
                    notationView.pinchToZoom(scale, pos)
                }

                onScrollHorizontal: function(newPos) {
                    notationView.scrollHorizontal(newPos)
                }

                onScrollVertical: function(newPos) {
                    notationView.scrollVertical(newPos)
                }
            }

            Loader {
                id: notationNavigator

                readonly property NotationNavigator navigatorItem: item as NotationNavigator

                property var orientation: navigatorItem?.orientation ?? Qt.Horizontal

                visible: false

                SplitView.preferredHeight: 100
                SplitView.preferredWidth: 100
                SplitView.minimumWidth: 30
                SplitView.minimumHeight: 30

                sourceComponent: visible ? navigatorComp : null

                function setCursorRect(viewport) {
                    if (navigatorItem) {
                        navigatorItem.setCursorRect(viewport)
                    }
                }
            }

            Loader {
                id: brailleViewLoader

                readonly property int navigationOrder: popUpLoader.navigationOrderEnd + 1

                active: false
                visible: active

                SplitView.fillWidth: true
                SplitView.preferredHeight: 50
                SplitView.minimumHeight: 30

                sourceComponent: BrailleView {
                    navigationPanel.section: navSec
                    navigationPanel.order: brailleViewLoader.navigationOrder

                    navigationPanel.onActiveChanged: function (active) {
                        if (active) {
                            notationView.navigationPanel.setActive(false);
                            fakeNavCtrl.setActive(false);
                        }
                    }
                }
            }

            Component {
                id: navigatorComp

                NotationNavigator {

                    property bool isVertical: orientation === Qt.Vertical

                    objectName: root.name + "Navigator"

                    Component.onCompleted: {
                        load()
                    }

                    onMoveNotationRequested: function(dx, dy) {
                        notationView.moveCanvas(dx, dy)
                    }
                }
            }

            handle: Rectangle {
                id: resizingHandle

                implicitWidth: 4
                implicitHeight: 4

                color: ui.theme.strokeColor

                states: [
                    State {
                        name: "PRESSED"
                        when: resizingHandle.SplitHandle.pressed
                        PropertyChanges {
                            target: resizingHandle
                            opacity: ui.theme.accentOpacityHit
                        }
                    },
                    State {
                        name: "HOVERED"
                        when: resizingHandle.SplitHandle.hovered
                        PropertyChanges {
                            target: resizingHandle
                            opacity: ui.theme.accentOpacityHover
                        }
                    }
                ]
            }
        }

        SearchPopup {
            id: searchPopup

            Layout.fillWidth: true

            navigationPanel.section: navSec
            navigationOrderStart: brailleViewLoader.navigationOrder + 1

            onClosed: {
                fakeNavCtrl.requestActive()
            }
        }
    }
}
