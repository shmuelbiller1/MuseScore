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
import QtQuick

import Muse.Ui
import Muse.UiComponents
import MuseScore.PropertiesPanel

import "../../common"

Column {
    id: root

    required property TempoSettingsModel model

    property NavigationPanel navigationPanel: null
    property int navigationRowStart: 1

    objectName: "TempoSettings"

    spacing: 12

    function focusOnFirst() {
        followWrittenTempoCheckbox.navigation.requestActive()
    }

    PropertyCheckBox {
        id: followWrittenTempoCheckbox
        text: qsTrc("propertiespanel", "Follow written tempo")
        propertyItem: root.model ? root.model.followText : null
        enabled: root.model ? !root.model.isEmpty : false

        navigation.name: "FollowCheckBox"
        navigation.panel: root.navigationPanel
        navigation.row: root.navigationRowStart + 1
    }

    SpinBoxPropertyView {
        titleText: qsTrc("propertiespanel", "Relative to preceding tempo")
        propertyItem: root.model ? root.model.relativeFactor : null
        visible: root.model ? root.model.relativeTempo : false
        // Metric modulations follow the written equation by default. Turn
        // that off before overriding its computed relative factor.
        enabled: root.model ? !root.model.isEmpty && !followWrittenTempoCheckbox.checked : false
        minValue: 0.1
        maxValue: 1000
        step: 0.1
        decimals: 1
        measureUnitsSymbol: "%"
        navigationName: "Relative tempo factor"
        navigationPanel: root.navigationPanel
        navigationRowStart: followWrittenTempoCheckbox.navigation.row + 1
    }

    SpinBoxPropertyView {
        titleText: qsTrc("propertiespanel", "Override written tempo")
        propertyItem: root.model ? root.model.tempo : null
        visible: root.model ? !root.model.relativeTempo : true
        enabled: root.model ? !root.model.isEmpty && !followWrittenTempoCheckbox.checked : false

        measureUnitsSymbol: qsTrc("propertiespanel", "BPM")

        navigationName: "Override"
        navigationPanel: root.navigationPanel
        navigationRowStart: followWrittenTempoCheckbox.navigation.row + 1
    }

    StyledTextLabel {
        width: parent.width
        visible: root.model ? !root.model.isEmpty : false
        text: qsTrc("propertiespanel", "Effective tempo at this marking: %1 BPM")
              .arg(root.model ? root.model.effectiveBpm : "—")
        horizontalAlignment: Text.AlignLeft
    }

    StyledTextLabel {
        width: parent.width
        visible: root.model ? !root.model.isEmpty : false
        text: root.model ? root.model.upcomingTempo : ""
        horizontalAlignment: Text.AlignLeft
    }
}
